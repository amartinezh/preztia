import { schema } from '@preztiaos/db';
import { reconcileBalance } from '@preztiaos/domain';
import type { TenantContext } from './context';
import type { BoxState, UserRef } from './model';
import { minor } from './scenario';

// TESORERÍA de oficina: saldos de apertura (arqueo + ajuste), provisión de efectivo para
// desembolsos, aportes y retiros de los socios, traslados entre cuentas, arqueos y sincronización
// del saldo bancario. Todo pasa por el libro (ledger) con las reglas del dominio.

const OPENING_NOTES =
  'Arqueo de apertura: saldo real al iniciar la operación en Preztia';
const OPENING_REASON = 'Saldo inicial de apertura (capital de trabajo)';
const PROVISION_REASON = 'Provisión de efectivo para desembolsos';
const CAPITAL_REASON = 'Aporte de capital del socio';
/** Margen que se deja en la caja al provisionar (para varios desembolsos del día). */
const PROVISION_MULTIPLIER = 3;
const MIN_PROVISION = minor(5000);
const CAPITAL_INJECTION = minor(60000);

/** Saldos de apertura: arqueo con el conteo real y ajuste que sella la diferencia. */
export function openBalances(
  ctx: TenantContext,
  performedBy: UserRef,
  at: Date,
): void {
  for (const spec of ctx.scenario.boxes) {
    if (!spec.openingMinor) continue;
    ctx.ledger.count({
      box: ctx.box(spec.key),
      countedMinor: spec.openingMinor,
      notes: OPENING_NOTES,
      performedBy: performedBy.id,
      at,
      adjust: { reason: OPENING_REASON, at },
    });
  }
}

/**
 * Garantiza que la caja que desembolsa tenga saldo: la provisiona desde la cuenta de tesorería
 * (y, si la tesorería no alcanza, registra un aporte de capital del socio).
 */
export function ensureFunds(
  ctx: TenantContext,
  input: {
    box: BoxState;
    amountMinor: number;
    treasury: BoxState;
    actor: UserRef;
    at: Date;
  },
): void {
  if (input.box.balance >= input.amountMinor) return;
  if (input.box.id === input.treasury.id) {
    injectCapital(
      ctx,
      input.treasury,
      input.actor,
      input.at,
      input.amountMinor,
    );
    return;
  }
  const provision = Math.max(
    MIN_PROVISION,
    input.amountMinor * PROVISION_MULTIPLIER,
  );
  if (input.treasury.balance < provision)
    injectCapital(ctx, input.treasury, input.actor, input.at, provision);
  ctx.ledger.transfer({
    from: input.treasury,
    to: input.box,
    amountMinor: provision,
    reason: PROVISION_REASON,
    at: input.at,
    createdBy: input.actor.id,
  });
}

/** Aporte de capital del socio: ingreso manual a la tesorería ("Movimientos → Ingreso"). */
export function injectCapital(
  ctx: TenantContext,
  box: BoxState,
  actor: UserRef,
  at: Date,
  atLeast = 0,
): void {
  ctx.ledger.post({
    box,
    direction: 'IN',
    kind: 'PAYMENT_IN',
    amountMinor: Math.max(CAPITAL_INJECTION, atLeast),
    reason: CAPITAL_REASON,
    at,
    createdBy: actor.id,
  });
  ctx.audit({
    at,
    actorId: actor.id,
    action: 'POST /cash/boxes/:id/movements',
    entity: 'cash',
    entityId: box.id,
    payload: { direction: 'IN', reason: CAPITAL_REASON },
  });
}

/** Retiro de la caja (exige motivo), p. ej. utilidades de los socios o arriendo. */
export function withdraw(
  ctx: TenantContext,
  box: BoxState,
  amountMinor: number,
  reason: string,
  actor: UserRef,
  at: Date,
): void {
  if (box.balance < amountMinor) return;
  ctx.ledger.post({
    box,
    direction: 'OUT',
    kind: 'WITHDRAWAL',
    amountMinor,
    reason,
    at,
    createdBy: actor.id,
  });
  ctx.audit({
    at,
    actorId: actor.id,
    action: 'POST /cash/boxes/:id/withdrawals',
    entity: 'cash',
    entityId: box.id,
    payload: { amountMinor, reason },
  });
}

/** Traslado entre cajas si el origen supera el umbral (deja `keepMinor` en el origen). */
export function sweep(
  ctx: TenantContext,
  input: {
    from: BoxState;
    to: BoxState;
    aboveMinor: number;
    keepMinor: number;
    reason: string;
    actor: UserRef;
    at: Date;
  },
): void {
  if (input.from.balance <= input.aboveMinor) return;
  ctx.ledger.transfer({
    from: input.from,
    to: input.to,
    amountMinor: input.from.balance - input.keepMinor,
    reason: input.reason,
    at: input.at,
    createdBy: input.actor.id,
  });
  ctx.audit({
    at: input.at,
    actorId: input.actor.id,
    action: 'POST /cash/transfers',
    entity: 'cash',
    entityId: null,
    payload: { reason: input.reason },
  });
}

/** Arqueo semanal; con `differenceMinor` ≠ 0 se registra el descuadre (y, si se pide, su ajuste). */
export function weeklyCount(
  ctx: TenantContext,
  input: {
    box: BoxState;
    performedBy: UserRef;
    at: Date;
    differenceMinor?: number;
    adjustReason?: string;
    notes?: string;
  },
): void {
  const difference = input.differenceMinor ?? 0;
  ctx.ledger.count({
    box: input.box,
    countedMinor: Math.max(0, input.box.balance + difference),
    notes:
      input.notes ??
      (difference === 0
        ? 'Arqueo semanal: cuadra'
        : 'Arqueo semanal con descuadre'),
    performedBy: input.performedBy.id,
    at: input.at,
    adjust:
      difference !== 0 && input.adjustReason
        ? { reason: input.adjustReason, at: input.at }
        : undefined,
  });
}

/** "Sincronizar saldo" contra el banco: foto append-only (cuadra, descuadre o no disponible). */
export function syncBankBalance(
  ctx: TenantContext,
  input: {
    box: BoxState;
    syncedBy: UserRef;
    at: Date;
    bankMinor: number | null;
  },
): void {
  const result = reconcileBalance(
    input.box.balance,
    input.bankMinor === null
      ? { kind: 'unavailable', reason: 'balance_not_supported' }
      : { kind: 'available', balanceMinor: input.bankMinor },
  );
  ctx.batch.insert(schema.bankReconciliation, {
    tenantId: ctx.tenantId,
    cashBoxId: input.box.id,
    systemMinor: input.box.balance,
    bankMinor: result.bankMinor,
    differenceMinor: result.differenceMinor,
    status: result.status,
    rawResponse:
      input.bankMinor === null
        ? {
            error: 'balance_not_supported',
            detail: 'El proveedor no expone el saldo por API',
          }
        : {
            availableBalance: input.bankMinor / 100,
            currency: ctx.currency,
            at: input.at.toISOString(),
          },
    syncedBy: input.syncedBy.id,
    createdAt: input.at,
  });
}
