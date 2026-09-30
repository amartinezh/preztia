import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CommissionPayment } from '@preztiaos/contracts';
import { type Tx } from '../tenancy/unit-of-work';

/**
 * Comisiones ya pagadas de una liquidación: los asientos COMMISSION del libro que ligan a ella (el
 * libro es la única fuente; no hay tabla paralela). Solo de los cobradores visibles para quien
 * consulta (los de la foto ya recortada a su alcance).
 */
export async function readCommissionPayments(
  tx: Tx,
  settlementId: string,
  visibleCollectorIds: readonly string[],
): Promise<CommissionPayment[]> {
  if (visibleCollectorIds.length === 0) return [];
  const rows = await tx
    .select({
      collectorId: schema.cashTransaction.collectorId,
      cashTransactionId: schema.cashTransaction.id,
      cashBoxId: schema.cashTransaction.cashBoxId,
      cashBoxName: schema.cashBox.name,
      amountMinor: schema.cashTransaction.amountMinor,
      paidAt: schema.cashTransaction.createdAt,
      paidBy: schema.cashTransaction.createdBy,
    })
    .from(schema.cashTransaction)
    .innerJoin(
      schema.cashBox,
      eq(schema.cashBox.id, schema.cashTransaction.cashBoxId),
    )
    .where(
      and(
        eq(schema.cashTransaction.settlementPeriodId, settlementId),
        inArray(schema.cashTransaction.collectorId, [...visibleCollectorIds]),
      ),
    );
  return rows.map((r) => ({
    collectorId: r.collectorId!,
    cashTransactionId: r.cashTransactionId,
    cashBoxId: r.cashBoxId,
    cashBoxName: r.cashBoxName,
    amountMinor: r.amountMinor,
    paidAt: r.paidAt.toISOString(),
    paidBy: r.paidBy,
  }));
}
