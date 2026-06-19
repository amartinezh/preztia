import { eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type Tx } from '../tenancy/unit-of-work';

/**
 * Saldo derivado de una caja: Σ asientos firmados por dirección (IN suma, OUT resta).
 * Fuente única de verdad del saldo (CQRS): nunca se almacena, siempre se recalcula.
 */
export async function balanceOfBox(tx: Tx, boxId: string): Promise<number> {
  const [row] = await tx
    .select({
      value: sql<number>`COALESCE(SUM(CASE WHEN ${schema.cashTransaction.direction} = 'IN' THEN ${schema.cashTransaction.amountMinor} ELSE -${schema.cashTransaction.amountMinor} END), 0)`,
    })
    .from(schema.cashTransaction)
    .where(eq(schema.cashTransaction.cashBoxId, boxId));
  return Number(row?.value ?? 0);
}
