import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  allocatePayment,
  assertManuallyVerifiable,
  Money,
  portfolioBalanceMinor,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { recordFraudAssessmentTx } from './fraud-assessment.recorder';
import { routeVerifiedPaymentToBox } from '../cash/payment-box-router';

export interface ManualVerifyResult {
  id: string;
  status: 'VERIFIED';
  balanceMinor: number;
}

/**
 * Validación MANUAL de un comprobante por el coordinador/admin: hace EFECTIVO el abono aunque el
 * pipeline lo haya marcado (fraude/sin verificar/inválido). Reusa el dominio puro `allocatePayment`
 * (cascada a la cuota más antigua) y escribe, en UNA transacción: asignaciones + actualización de
 * cuotas (con guardia paid ≤ due) + estado VERIFIED + evento append-only con el motivo obligatorio
 * y quién decidió (auditabilidad financiera). El guard de dominio impide revalidar lo ya VERIFIED.
 */
@Injectable()
export class ManualVerifyPaymentRepository {
  async verify(input: {
    tenantId: string;
    paymentId: string;
    decidedBy: string;
    reason: string;
    /** Monto a abonar si el OCR falló; por defecto el monto del pago. */
    amountMinorOverride?: number;
  }): Promise<ManualVerifyResult> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [pay] = await tx
        .select({
          id: schema.payment.id,
          creditId: schema.payment.creditId,
          status: schema.payment.status,
          amountMinor: schema.payment.amountMinor,
          currency: schema.payment.currency,
          receiverPixKey: schema.payment.receiverPixKey,
        })
        .from(schema.payment)
        .where(eq(schema.payment.id, input.paymentId))
        .limit(1);
      if (!pay) throw new NotFoundException('Pago no encontrado');

      // Regla de dominio: no revalidar un pago ya efectivo (lanza ConflictError → 409).
      assertManuallyVerifiable(pay.status);

      if (!pay.creditId) {
        throw new NotFoundException(
          'El comprobante no está asociado a un crédito',
        );
      }

      // ¿Hay un crédito REAL reservado para este pago? (conciliación manual: el toggle
      // autoConfirmSettlement está apagado y el match quedó a la espera de esta aprobación). Si lo
      // hay, el monto por defecto es el del crédito real; el operador aún puede sobreescribirlo.
      const [reserved] = await tx
        .select({
          amountMinor: schema.incomingCredit.amountMinor,
          sourceId: schema.incomingCredit.sourceId,
        })
        .from(schema.incomingCredit)
        .where(eq(schema.incomingCredit.consumedByPaymentId, pay.id))
        .limit(1);

      const amountMinor =
        input.amountMinorOverride ?? reserved?.amountMinor ?? pay.amountMinor;
      if (amountMinor == null || amountMinor <= 0) {
        throw new NotFoundException(
          'El comprobante no tiene un monto válido para abonar',
        );
      }

      const installments = await loadInstallments(tx, pay.creditId);
      const result = allocatePayment(
        pay.currency,
        installments,
        Money.of(amountMinor, pay.currency),
      );

      // Aplica las asignaciones con guardia de concurrencia (paid ≤ due).
      for (const allocation of result.allocations) {
        const updated = await tx
          .update(schema.installment)
          .set({
            paidMinor: sql`${schema.installment.paidMinor} + ${allocation.amountMinor}`,
            status: sql`case when ${schema.installment.paidMinor} + ${allocation.amountMinor} >= ${schema.installment.amountDueMinor} then 'PAID'::installment_status else 'PARTIALLY_PAID'::installment_status end`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.installment.id, allocation.installmentId),
              sql`${schema.installment.paidMinor} + ${allocation.amountMinor} <= ${schema.installment.amountDueMinor}`,
            ),
          )
          .returning({ id: schema.installment.id });
        if (!updated.length) {
          throw new Error(
            `Abono rechazado: la cuota ${allocation.installmentId} ya no admite el monto (operación concurrente)`,
          );
        }
      }
      if (result.allocations.length) {
        await tx.insert(schema.paymentAllocation).values(
          result.allocations.map((a) => ({
            tenantId: input.tenantId,
            paymentId: pay.id,
            installmentId: a.installmentId,
            amountMinor: a.amountMinor,
          })),
        );
      }

      await tx
        .update(schema.payment)
        .set({ status: 'VERIFIED', amountMinor, verifiedAt: new Date() })
        .where(eq(schema.payment.id, pay.id));

      // La confirmación humana es lo que hace ENTRAR el dinero a su caja: postea PAYMENT_IN a la
      // caja bancaria (por llave PIX) o a Tránsito si no se identifica, en esta misma transacción.
      // Idempotente por `cash_tx_payment_idx`: un pago se rutea a una sola caja.
      await routeVerifiedPaymentToBox(tx, {
        tenantId: input.tenantId,
        paymentId: pay.id,
        receiverPixKey: pay.receiverPixKey,
        amountMinor,
        currency: pay.currency,
        createdBy: input.decidedBy,
      });

      await tx.insert(schema.paymentEvent).values({
        tenantId: input.tenantId,
        paymentId: pay.id,
        creditId: pay.creditId,
        type: 'manual_verification',
        payload: {
          decidedBy: input.decidedBy,
          reason: input.reason,
          amountMinor,
          previousStatus: pay.status,
          allocations: result.allocations.length,
          settled: result.creditSettled,
          // Si un crédito real respaldaba el pago (conciliación manual), se traza su origen.
          ...(reserved ? { settlementSourceId: reserved.sourceId } : {}),
        },
      });

      // Traza antifraude: aprobación humana. Si había crédito real reservado, es una confirmación
      // por ground truth (Fase 2); si no, es un override manual del operador.
      await recordFraudAssessmentTx(tx, {
        tenantId: input.tenantId,
        paymentId: pay.id,
        phase: 'PHASE2_SETTLEMENT',
        status: 'CONFIRMED',
        score: null,
        reasons: reserved
          ? [
              `Aprobación humana con crédito real (SOURCE_ID ${reserved.sourceId})`,
            ]
          : [`Aprobación humana manual: ${input.reason}`],
      });

      return {
        id: pay.id,
        status: 'VERIFIED',
        balanceMinor: portfolioBalanceMinor(result.installments),
      };
    });
  }
}

async function loadInstallments(
  tx: Tx,
  creditId: string,
): Promise<PortfolioInstallment[]> {
  const rows = await tx
    .select()
    .from(schema.installment)
    .where(eq(schema.installment.creditId, creditId))
    .orderBy(asc(schema.installment.seq));
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    dueDate: row.dueDate,
    amountDueMinor: row.amountDueMinor,
    paidMinor: row.paidMinor,
    status: row.status,
  }));
}
