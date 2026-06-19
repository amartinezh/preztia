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
      const amountMinor = input.amountMinorOverride ?? pay.amountMinor;
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
        },
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
