import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  allocatePayment,
  Money,
  portfolioBalanceMinor,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';

export interface CashPaymentResult {
  id: string;
  creditId: string;
  amountMinor: number;
  balanceMinor: number;
}

/**
 * Registra un abono en EFECTIVO (cobro de ruta) de forma ATÓMICA e IDEMPOTENTE.
 * Reusa el dominio puro `allocatePayment` (cascada a la cuota más antigua) y persiste
 * pago + asignaciones + actualización de cuotas + evento de auditoría en una sola
 * transacción. Devuelve `null` si el crédito no existe.
 */
@Injectable()
export class CashPaymentDrizzleRepository {
  async register(input: {
    tenantId: string;
    creditId: string;
    amountMinor: number;
    idempotencyKey: string | null;
  }): Promise<CashPaymentResult | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      // 1. Idempotencia: si esta clave ya materializó un abono, devolver su resultado
      //    sin volver a abonar (sin doble cobro).
      if (input.idempotencyKey) {
        const [existing] = await tx
          .select({
            id: schema.payment.id,
            creditId: schema.payment.creditId,
            amountMinor: schema.payment.amountMinor,
          })
          .from(schema.payment)
          .where(eq(schema.payment.idempotencyKey, input.idempotencyKey));
        if (existing) {
          const creditId = existing.creditId ?? input.creditId;
          return {
            id: existing.id,
            creditId,
            amountMinor: existing.amountMinor ?? input.amountMinor,
            balanceMinor: await balanceOf(tx, creditId),
          };
        }
      }

      // 2. Cargar crédito + cuotas.
      const [credit] = await tx
        .select({ id: schema.credit.id, currency: schema.credit.currency })
        .from(schema.credit)
        .where(eq(schema.credit.id, input.creditId));
      if (!credit) return null;

      const installments = await loadInstallments(tx, input.creditId);

      // 3. Regla de dominio: repartir el abono en cascada.
      const result = allocatePayment(
        credit.currency,
        installments,
        Money.of(input.amountMinor, credit.currency),
      );

      // 4. Persistir el pago (efectivo confirmado por el cobrador → VERIFIED).
      const [inserted] = await tx
        .insert(schema.payment)
        .values({
          tenantId: input.tenantId,
          creditId: input.creditId,
          payerPhone: '',
          amountMinor: input.amountMinor,
          currency: credit.currency,
          paidAt: new Date(),
          status: 'VERIFIED',
          idempotencyKey: input.idempotencyKey,
        })
        .returning({ id: schema.payment.id });
      const paymentId = inserted.id;

      // 5. Aplicar las asignaciones con guardia de concurrencia (paid ≤ due) e
      //    insertar las filas auditables de asignación.
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
            paymentId,
            installmentId: a.installmentId,
            amountMinor: a.amountMinor,
          })),
        );
      }

      // 6. Traza append-only del movimiento de dinero (auditabilidad financiera).
      await tx.insert(schema.paymentEvent).values({
        tenantId: input.tenantId,
        paymentId,
        creditId: input.creditId,
        type: 'cash_payment_registered',
        payload: {
          amountMinor: input.amountMinor,
          allocations: result.allocations.length,
          settled: result.creditSettled,
        },
      });

      return {
        id: paymentId,
        creditId: input.creditId,
        amountMinor: input.amountMinor,
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

async function balanceOf(tx: Tx, creditId: string): Promise<number> {
  return portfolioBalanceMinor(await loadInstallments(tx, creditId));
}
