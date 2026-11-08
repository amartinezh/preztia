import { eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { Tx } from '../tenancy/unit-of-work';
import { sumTreasuryByClass, type TreasuryByClass } from './treasury-by-class';

// Suma firmada del libro mayor de caja: IN suma, OUT resta (mismo criterio en todo el libro).
const signedCashSum = sql<number>`COALESCE(SUM(CASE WHEN ${schema.cashTransaction.direction} = 'IN' THEN ${schema.cashTransaction.amountMinor} ELSE -${schema.cashTransaction.amountMinor} END), 0)`;

/**
 * FUENTE ÚNICA de la tesorería: saldo de cada caja activa (Σ asientos firmados, agrupado en BD) y
 * reparto por clase con la regla pura. La usan el panel de Inicio, el Resumen de Dinero y el panel
 * de Operación, así que "cuánto dinero tengo" es la misma cifra en toda la app. Dentro de la
 * transacción del llamador (RLS aísla por tenant).
 */
export async function loadTreasuryByClass(tx: Tx): Promise<TreasuryByClass> {
  const rows = await tx
    .select({
      type: schema.cashBox.type,
      assignedTo: schema.cashBox.assignedTo,
      balanceMinor: signedCashSum,
    })
    .from(schema.cashBox)
    .leftJoin(
      schema.cashTransaction,
      eq(schema.cashTransaction.cashBoxId, schema.cashBox.id),
    )
    .where(eq(schema.cashBox.active, true))
    .groupBy(schema.cashBox.id);
  return sumTreasuryByClass(
    rows.map((row) => ({
      type: row.type,
      assignedTo: row.assignedTo,
      balanceMinor: Number(row.balanceMinor ?? 0),
    })),
  );
}
