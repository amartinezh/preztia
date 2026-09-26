import { eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  ConflictError,
  assertZoneCanUseBox,
  ledgerAttribution,
  type LedgerAttribution,
} from '@preztiaos/domain';
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

/**
 * Candado transaccional por caja (serializa leer saldo → postear). Todo asiento a una caja se
 * inserta bajo este candado; con `created_at = clock_timestamp()` el orden de los asientos
 * coincide con el de los candados (base del corte de la rendición del cobrador).
 */
export async function lockCashBox(tx: Tx, cashBoxId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${cashBoxId}))`);
}

/** Origen de negocio de un asiento, del que sale su zona (a lo sumo uno poblado). */
export interface LedgerOrigin {
  readonly creditId?: string | null;
  readonly paymentId?: string | null;
  readonly expenseId?: string | null;
}

/**
 * Zona y cobrador a SELLAR en un asiento (regla de dominio `ledgerAttribution`): la zona del
 * crédito de origen (directo o vía el pago) o, si no hay, la de la caja; y el cobrador dueño
 * de la caja de ruta. Todos los escritores del libro la usan para que la atribución sea una.
 */
export async function attributionFor(
  tx: Tx,
  cashBoxId: string,
  origin: LedgerOrigin = {},
): Promise<LedgerAttribution> {
  const [box] = await tx
    .select({
      zoneId: schema.cashBox.zoneId,
      assignedTo: schema.cashBox.assignedTo,
    })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.id, cashBoxId))
    .limit(1);
  const fromOrigin = await originAttribution(tx, origin);
  return ledgerAttribution({
    originZoneId: fromOrigin.zoneId,
    originCollectorId: fromOrigin.collectorId,
    box: { zoneId: box?.zoneId ?? null, assignedTo: box?.assignedTo ?? null },
  });
}

/**
 * Fallo rápido (409) si la caja no puede fondear el crédito: una caja de ruta de cobrador nunca
 * (ROUTE_BOX_CANNOT_FUND); y solo cajas del tenant, de la zona o de una zona superior
 * (BOX_NOT_USABLE_BY_ZONE).
 */
export async function assertCreditCanUseBox(
  tx: Tx,
  creditId: string,
  cashBoxId: string,
): Promise<void> {
  const [row] = await tx
    .select({ creditZonePath: schema.zone.path })
    .from(schema.credit)
    .innerJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
    .where(eq(schema.credit.id, creditId))
    .limit(1);
  const [box] = await tx
    .select({ assignedTo: schema.cashBox.assignedTo })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.id, cashBoxId))
    .limit(1);
  // La caja de ruta es el efectivo del cobrador: sacar de ella descuadraría su rendición.
  if (box?.assignedTo) {
    throw new ConflictError(
      'Una caja de ruta de cobrador no puede fondear créditos',
      'ROUTE_BOX_CANNOT_FUND',
    );
  }
  if (!row) return; // sin zona resoluble no hay regla que aplicar (lo valida quien crea el crédito)
  assertZoneCanUseBox(row.creditZonePath, await boxZonePath(tx, cashBoxId));
}

async function boxZonePath(tx: Tx, cashBoxId: string): Promise<string | null> {
  const [row] = await tx
    .select({ path: schema.zone.path })
    .from(schema.cashBox)
    .innerJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(eq(schema.cashBox.id, cashBoxId))
    .limit(1);
  return row?.path ?? null;
}

/** Zona (y cobrador, si aplica) del hecho de negocio que origina el asiento. */
async function originAttribution(
  tx: Tx,
  origin: LedgerOrigin,
): Promise<{ zoneId: string | null; collectorId: string | null }> {
  if (origin.creditId) {
    const [row] = await tx
      .select({ zoneId: schema.credit.zoneId })
      .from(schema.credit)
      .where(eq(schema.credit.id, origin.creditId))
      .limit(1);
    return { zoneId: row?.zoneId ?? null, collectorId: null };
  }
  if (origin.paymentId) {
    const [row] = await tx
      .select({ zoneId: schema.credit.zoneId })
      .from(schema.payment)
      .innerJoin(schema.credit, eq(schema.credit.id, schema.payment.creditId))
      .where(eq(schema.payment.id, origin.paymentId))
      .limit(1);
    return { zoneId: row?.zoneId ?? null, collectorId: null };
  }
  if (origin.expenseId) {
    // El gasto se atribuye a su zona y a quien lo pidió, aunque se pague desde la oficina.
    const [row] = await tx
      .select({
        zoneId: schema.expense.zoneId,
        requestedBy: schema.expense.requestedBy,
      })
      .from(schema.expense)
      .where(eq(schema.expense.id, origin.expenseId))
      .limit(1);
    return {
      zoneId: row?.zoneId ?? null,
      collectorId: row?.requestedBy ?? null,
    };
  }
  return { zoneId: null, collectorId: null };
}
