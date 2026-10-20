import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  assertCanPayCommissionFrom,
  assertCommissionPayable,
  ConflictError,
  type SettlementSnapshot,
} from '@preztiaos/domain';
import { SettlementRepository } from '../../src/settlements/settlement.repository';
import type { TenantContext } from './context';
import type { BoxState, UserRef } from './model';

// LIQUIDACIÓN por períodos. El seed NO arma la foto a mano: usa el `SettlementRepository` real de
// la API (mismo `buildSettlement` del dominio, mismas consultas sobre el libro y la cartera) con un
// "ahora" simulado, de modo que cada período sellado es exactamente el que produciría el sistema.
// Solo se ajusta después el instante del cierre (closed_at y su auditoría) al momento simulado.

const DONE_CODES = new Set(['PERIOD_NOT_ENDED', 'NOTHING_TO_SETTLE']);

export interface ClosedPeriod {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly endsAt: Date;
  readonly snapshot: SettlementSnapshot;
}

const repository = new SettlementRepository();

/**
 * Cierra el siguiente período terminado a la fecha simulada `now` (null si no hay nada que cerrar).
 * El búfer del día anterior debe estar ya persistido: el cierre lee el libro desde la base.
 */
export async function closeNextPeriod(
  ctx: TenantContext,
  input: { now: Date; closedBy: UserRef | null },
): Promise<ClosedPeriod | null> {
  let id: string;
  try {
    id = await repository.close({
      tenantId: ctx.tenantId,
      currency: ctx.currency,
      closedBy: input.closedBy?.id ?? null,
      now: input.now,
    });
  } catch (err) {
    if (err instanceof ConflictError && DONE_CODES.has(err.code ?? ''))
      return null;
    throw err;
  }
  await ctx.db
    .update(schema.settlementPeriod)
    .set({ closedAt: input.now })
    .where(eq(schema.settlementPeriod.id, id));
  await ctx.db
    .update(schema.auditLog)
    .set({ createdAt: input.now })
    .where(
      and(
        eq(schema.auditLog.entityId, id),
        eq(schema.auditLog.action, 'CLOSE settlement-period'),
      ),
    );
  const [row] = await ctx.db
    .select()
    .from(schema.settlementPeriod)
    .where(eq(schema.settlementPeriod.id, id));
  ctx.sealedUntil = row!.endsAt;
  ctx.stats.settlements += 1;
  return {
    id,
    periodStart: row!.periodStart,
    periodEnd: row!.periodEnd,
    endsAt: row!.endsAt,
    snapshot: row!.snapshot as SettlementSnapshot,
  };
}

/** Comisiones causadas (> 0) en la foto sellada, por cobrador. */
export function commissionsDue(period: ClosedPeriod): Array<{
  collectorId: string;
  amountMinor: number;
  zoneId: string | null;
  zonePath: string | null;
}> {
  return period.snapshot.collectors
    .filter((c) => (c.commission?.amountMinor ?? 0) > 0)
    .map((c) => ({
      collectorId: c.collectorId,
      amountMinor: c.commission!.amountMinor,
      zoneId: c.zoneId,
      zonePath: c.zonePath,
    }));
}

/** Pago de la comisión: asiento COMMISSION que liga a la liquidación (una sola vez por cobrador). */
export function payCommission(
  ctx: TenantContext,
  input: {
    period: ClosedPeriod;
    due: ReturnType<typeof commissionsDue>[number];
    box: BoxState;
    paidBy: UserRef;
    at: Date;
  },
): void {
  assertCommissionPayable(input.due.amountMinor);
  assertCanPayCommissionFrom({
    collectorId: input.due.collectorId,
    collectorZonePath: input.due.zonePath,
    box: { assignedTo: input.box.assignedTo, zonePath: input.box.zonePath },
  });
  const cashTransactionId = ctx.ledger.post({
    box: input.box,
    direction: 'OUT',
    kind: 'COMMISSION',
    amountMinor: input.due.amountMinor,
    reason: `Comisión del cobrador, liquidación ${input.period.periodStart} → ${input.period.periodEnd}`,
    at: input.at,
    createdBy: input.paidBy.id,
    originZoneId: input.due.zoneId,
    originCollectorId: input.due.collectorId,
    refs: { settlementPeriodId: input.period.id },
  });
  ctx.audit({
    at: input.at,
    actorId: input.paidBy.id,
    action: 'PAY collector-commission',
    entity: 'settlement-period',
    entityId: input.period.id,
    payload: {
      collectorId: input.due.collectorId,
      cashBoxId: input.box.id,
      amountMinor: input.due.amountMinor,
      cashTransactionId,
    },
  });
}
