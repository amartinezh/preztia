import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  carriedDebtMinor,
  DEFAULT_REMITTANCE_DEADLINE_HOUR,
  remittanceObligation,
  summarizeRemittance,
  type CashTxDirection,
  type CashTxKind,
  type RemittanceObligation,
  type RemittanceSummary,
} from '@preztiaos/domain';
import type { RemittanceView } from '@preztiaos/contracts';
import { type Tx } from '../tenancy/unit-of-work';
import { balanceOfBox } from './cash-ledger';
import { resolveTenantTimeZone } from '../tenant-config/tenant-timezone';

const MS_PER_MINUTE = 60_000;

type RemittanceRow = typeof schema.collectorRemittance.$inferSelect;

/** Zona horaria del tenant y hora local límite para rendir. */
export interface RemittanceSchedule {
  readonly timeZone: string;
  readonly deadlineHourLocal: number;
}

/** Zona horaria del tenant y hora límite de rendición de sus ajustes operativos. */
export async function resolveRemittanceSchedule(
  tx: Tx,
  tenantId: string,
): Promise<RemittanceSchedule> {
  const rows = (await tx.execute(sql`
    SELECT (operational_settings->>'remittanceDeadlineHourLocal')::int AS deadline_hour
    FROM tenant_config WHERE tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ deadline_hour: number | null }>;
  return {
    timeZone: await resolveTenantTimeZone(tx, tenantId),
    deadlineHourLocal:
      rows[0]?.deadline_hour ?? DEFAULT_REMITTANCE_DEADLINE_HOUR,
  };
}

/** Estado de la caja de ruta desde el último corte (misma foto para el cobrador y el coordinador). */
export interface RouteBoxState {
  readonly balanceMinor: number;
  readonly summary: RemittanceSummary;
  readonly obligation: RemittanceObligation;
  readonly carriedDebtMinor: number;
  readonly hasUnremittedCollections: boolean;
  readonly open: RemittanceRow | null;
}

/**
 * Calcula el estado de la caja de ruta con las reglas del dominio. Invariante verificado: el
 * esperado del resumen (saldo al corte + movimientos posteriores) coincide con el saldo del libro;
 * si no, se falla rápido (el orden total por caja estaría roto).
 */
export async function loadRouteBoxState(
  tx: Tx,
  input: {
    cashBoxId: string;
    collectorId: string;
    now: Date;
    schedule: RemittanceSchedule;
  },
): Promise<RouteBoxState> {
  const cut = await lastCut(tx, input.cashBoxId);
  const movements = await tx
    .select({
      direction: schema.cashTransaction.direction,
      kind: schema.cashTransaction.kind,
      amountMinor: schema.cashTransaction.amountMinor,
      createdAt: schema.cashTransaction.createdAt,
    })
    .from(schema.cashTransaction)
    .where(
      and(
        eq(schema.cashTransaction.cashBoxId, input.cashBoxId),
        // Se compara en SQL contra el valor guardado (microsegundos): pasar el corte por un Date
        // de JS (milisegundos) haría contar como posterior la propia entrega del corte.
        cut
          ? sql`${schema.cashTransaction.createdAt} > (SELECT cut_at FROM collector_remittance WHERE id = ${cut.id})`
          : undefined,
      ),
    );

  const openingMinor = cut?.closingBalanceMinor ?? 0;
  const summary = summarizeRemittance(openingMinor, movements);
  const balanceMinor = await balanceOfBox(tx, input.cashBoxId);
  if (summary.expectedMinor !== balanceMinor) {
    throw new Error(
      `Rendición inconsistente en la caja ${input.cashBoxId}: esperado ${summary.expectedMinor} ≠ saldo ${balanceMinor}`,
    );
  }

  const collections = movements.filter(isCollection);
  const oldest = collections.reduce<Date | null>(
    (min, m) => (min === null || m.createdAt < min ? m.createdAt : min),
    null,
  );
  const open = await findOpenRemittance(tx, input.collectorId);
  return {
    balanceMinor,
    summary,
    obligation: remittanceObligation({
      hasOpenSubmission: open !== null,
      oldestUnremittedCollectionAt: oldest,
      now: input.now,
      ...input.schedule,
    }),
    carriedDebtMinor: carriedDebtMinor(openingMinor, summary.debtClosedMinor),
    hasUnremittedCollections: collections.length > 0,
    open,
  };
}

function isCollection(m: {
  direction: CashTxDirection;
  kind: CashTxKind;
}): boolean {
  return m.direction === 'IN' && m.kind === 'PAYMENT_IN';
}

/** Último corte recibido de la caja: lo posterior pertenece a la siguiente rendición. */
async function lastCut(
  tx: Tx,
  cashBoxId: string,
): Promise<{ id: string; closingBalanceMinor: number } | null> {
  const [row] = await tx
    .select({
      id: schema.collectorRemittance.id,
      closingBalanceMinor: schema.collectorRemittance.closingBalanceMinor,
    })
    .from(schema.collectorRemittance)
    .where(
      and(
        eq(schema.collectorRemittance.cashBoxId, cashBoxId),
        eq(schema.collectorRemittance.status, 'RECEIVED'),
      ),
    )
    .orderBy(sql`${schema.collectorRemittance.cutAt} DESC`)
    .limit(1);
  if (!row || row.closingBalanceMinor == null) return null;
  return { id: row.id, closingBalanceMinor: row.closingBalanceMinor };
}

export async function findOpenRemittance(
  tx: Tx,
  collectorId: string,
): Promise<RemittanceRow | null> {
  const [row] = await tx
    .select()
    .from(schema.collectorRemittance)
    .where(
      and(
        eq(schema.collectorRemittance.collectorId, collectorId),
        eq(schema.collectorRemittance.status, 'SUBMITTED'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Vista de contrato de una rendición. */
export function toRemittanceView(row: RemittanceRow): RemittanceView {
  const lateMs =
    row.dueAt && row.submittedAt > row.dueAt
      ? row.submittedAt.getTime() - row.dueAt.getTime()
      : 0;
  return {
    id: row.id,
    collectorId: row.collectorId,
    cashBoxId: row.cashBoxId,
    status: row.status,
    businessDate: row.businessDate,
    dueAt: row.dueAt?.toISOString() ?? null,
    submittedAt: row.submittedAt.toISOString(),
    lateMinutesAtSubmission: Math.floor(lateMs / MS_PER_MINUTE),
    summary: row.summary,
    declaredMinor: row.declaredMinor,
    collectorNote: row.collectorNote,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    receivedBy: row.receivedBy,
    destinationCashBoxId: row.destinationCashBoxId,
    expectedAtReceptionMinor: row.expectedAtReceptionMinor,
    countedMinor: row.countedMinor,
    shortfallMinor: row.shortfallMinor,
    closingBalanceMinor: row.closingBalanceMinor,
    receiverNote: row.receiverNote,
  };
}
