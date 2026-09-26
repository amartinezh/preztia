import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { splitAllocations, type PaymentAllocation } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/**
 * Aplica las asignaciones de UN pago a las cuotas de su crédito y persiste las filas
 * auditables de `payment_allocation` con su desglose capital/interés, dentro de la
 * transacción del llamador. Punto ÚNICO de escritura de abonos (efectivo, PIX, conciliación
 * y verificación manual).
 *
 * - Bloquea la fila del crédito (FOR UPDATE) para que "lo pagado antes" del desglose sea
 *   exacto aunque lleguen dos pagos a la vez al mismo crédito.
 * - Incrementos acotados (paid ≤ due): si otra operación ya abonó la cuota, la condición no
 *   matchea y la transacción completa se revierte (nunca un saldo corrupto en silencio).
 */
export async function applyAllocationsTx(
  tx: Tx,
  input: {
    tenantId: string;
    paymentId: string;
    creditId: string | null;
    allocations: readonly PaymentAllocation[];
  },
): Promise<void> {
  if (input.allocations.length === 0) return;
  if (!input.creditId) {
    throw new Error('Un abono con asignaciones exige un crédito');
  }

  const splits = splitAllocations(
    await loadRepaymentTerms(tx, input.creditId),
    await paidSoFarMinor(tx, input.creditId),
    input.allocations,
  );

  for (const allocation of splits) {
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

  await tx.insert(schema.paymentAllocation).values(
    splits.map((s) => ({
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      installmentId: s.installmentId,
      amountMinor: s.amountMinor,
      principalMinor: s.principalMinor,
      interestMinor: s.interestMinor,
    })),
  );
}

/** Capital del crédito y total a pagar (Σ cuotas), con la fila del crédito bloqueada. */
async function loadRepaymentTerms(
  tx: Tx,
  creditId: string,
): Promise<{ principalMinor: number; totalDueMinor: number }> {
  const [credit] = await tx
    .select({ principalMinor: schema.credit.principalMinor })
    .from(schema.credit)
    .where(eq(schema.credit.id, creditId))
    .for('update');
  if (!credit) throw new Error(`Crédito ${creditId} no encontrado al abonar`);

  const [due] = await tx
    .select({
      value: sql<string>`COALESCE(SUM(${schema.installment.amountDueMinor}), 0)`,
    })
    .from(schema.installment)
    .where(eq(schema.installment.creditId, creditId));
  return {
    principalMinor: credit.principalMinor,
    totalDueMinor: Number(due?.value ?? 0),
  };
}

async function paidSoFarMinor(tx: Tx, creditId: string): Promise<number> {
  const [row] = await tx
    .select({
      value: sql<string>`COALESCE(SUM(${schema.installment.paidMinor}), 0)`,
    })
    .from(schema.installment)
    .where(eq(schema.installment.creditId, creditId));
  return Number(row?.value ?? 0);
}
