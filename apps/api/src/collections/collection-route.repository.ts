import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  ConflictError,
  assertDispatchable,
  cancelStop,
  countsAsVisit,
  markStopSeen,
  resolveStop,
} from '@preztiaos/domain';
import type {
  DispatchRouteInput,
  ResolveStopInput,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { tenantToday } from '../tenant-config/tenant-timezone';
import { findRouteBox } from '../cash/payment-box-router';
import { registerCashPaymentTx } from '../payments/cash-payment.repository';
import { daysSince } from './critical-clients.repository';
import { loadRouteCandidates, type RouteCandidate } from './route-candidates';

type StopRow = typeof schema.routeStop.$inferSelect;

const UNIQUE_VIOLATION = '23505';
const OPEN_STOP_INDEX = 'route_stop_one_open_idx';
const AUDIT_ENTITY = 'collection-route';

// Texto de la observación que deja cada resultado en la bitácora de cobranza del crédito.
const OUTCOME_NOTE: Record<ResolveStopInput['outcome'], string> = {
  PAID: 'Visita de ruta: pagó',
  NOT_PAID: 'Visita de ruta: no pagó',
  PROMISE: 'Visita de ruta: promesa de pago',
  NOT_FOUND: 'Visita de ruta: cliente no encontrado',
};

/**
 * Escrituras de las ÓRDENES DE RUTA. Despachar copia la vista mínima de cada cliente a su parada;
 * liquidar es UNA transacción: parada + (si pagó) abono en efectivo a la caja de ruta de quien
 * cobró + observación + visita (reagenda por ciclo de mora). Reglas en `route-stop.ts`.
 */
@Injectable()
export class CollectionRouteDrizzleRepository {
  async dispatch(input: {
    tenantId: string;
    createdBy: string;
    zoneScope: SQL | undefined;
    currency: string;
    body: DispatchRouteInput;
  }): Promise<string> {
    assertDispatchable(input.body.stops);
    return withTenantTxFor(input.tenantId, async (tx) => {
      const zonePath = await zoneInScope(
        tx,
        input.body.zoneId,
        input.zoneScope,
      );
      const today = await tenantToday(tx, input.tenantId);
      await assertCollectorsCanCollect(
        tx,
        [...new Set(input.body.stops.map((s) => s.collectorId))],
        input.currency,
      );
      const candidates = await loadRouteCandidates(tx, {
        zonePath,
        today,
        creditIds: input.body.stops.map((s) => s.creditId),
      });
      const byCredit = new Map(candidates.map((c) => [c.creditId, c]));

      const [route] = await tx
        .insert(schema.collectionRoute)
        .values({
          tenantId: input.tenantId,
          zoneId: input.body.zoneId,
          serviceDate: today,
          createdBy: input.createdBy,
        })
        .returning({ id: schema.collectionRoute.id });

      const stops = input.body.stops.map((s, index) => {
        const candidate = byCredit.get(s.creditId);
        if (!candidate) {
          throw new BadRequestException(
            'Un cliente de la ruta no tiene un crédito activo en la zona',
          );
        }
        if (candidate.alreadyDispatched) throw stopAlreadyOpen();
        return stopValues(
          input.tenantId,
          route.id,
          s.collectorId,
          index + 1,
          candidate,
        );
      });
      try {
        await tx.insert(schema.routeStop).values(stops);
      } catch (err) {
        // Carrera: otro despacho abrió la misma parada entre la lectura y el insert.
        if (isOpenStopViolation(err)) throw stopAlreadyOpen();
        throw err;
      }
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.createdBy,
        action: 'DISPATCH collection-route',
        entity: AUDIT_ENTITY,
        entityId: route.id,
        payload: { stops: stops.length, zoneId: input.body.zoneId },
      });
      return route.id;
    });
  }

  /** El cobrador abrió la parada (queda vista la primera vez). */
  async markSeen(input: {
    tenantId: string;
    collectorId: string;
    stopId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const stop = await loadOwnStop(tx, input.stopId, input.collectorId);
      const next = markStopSeen(stop.status);
      if (!next) return;
      await tx
        .update(schema.routeStop)
        .set({ status: next, seenAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.routeStop.id, stop.id));
    });
  }

  /** Liquidación de la visita: todo o nada con el abono y la visita. */
  async resolve(input: {
    tenantId: string;
    collectorId: string;
    stopId: string;
    body: ResolveStopInput;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const stop = await loadOwnStop(tx, input.stopId, input.collectorId);
      const today = await tenantToday(tx, input.tenantId);
      const next = resolveStop(stop.status, { ...input.body, today });

      let paymentId: string | null = null;
      if (input.body.outcome === 'PAID' && input.body.collectedMinor) {
        const payment = await registerCashPaymentTx(tx, {
          tenantId: input.tenantId,
          creditId: stop.creditId,
          amountMinor: input.body.collectedMinor,
          idempotencyKey: null,
          receivedBy: input.collectorId,
        });
        if (!payment)
          throw new NotFoundException('El crédito de la parada ya no existe');
        paymentId = payment.id;
      }

      await tx.insert(schema.collectionNote).values({
        tenantId: input.tenantId,
        creditId: stop.creditId,
        borrowerId: stop.borrowerId,
        authorId: input.collectorId,
        body: noteFor(input.body),
      });
      if (countsAsVisit(input.body.outcome)) {
        await recordVisit(tx, input.tenantId, stop, input.collectorId, today);
      }

      const now = new Date();
      await tx
        .update(schema.routeStop)
        .set({
          status: next,
          outcome: input.body.outcome,
          collectedMinor:
            input.body.outcome === 'PAID'
              ? (input.body.collectedMinor ?? null)
              : null,
          outcomeReason: input.body.reason?.trim() || null,
          promiseDate: input.body.promiseDate ?? null,
          note: input.body.note?.trim() || null,
          paymentId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.routeStop.id, stop.id));
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.collectorId,
        action: 'RESOLVE route-stop',
        entity: AUDIT_ENTITY,
        entityId: stop.id,
        payload: {
          outcome: input.body.outcome,
          collectedMinor: input.body.collectedMinor ?? null,
        },
      });
    });
  }

  /** El coordinador cancela una parada abierta de su alcance, con motivo. */
  async cancel(input: {
    tenantId: string;
    cancelledBy: string;
    stopId: string;
    zoneScope: SQL | undefined;
    reason: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ stop: schema.routeStop })
        .from(schema.routeStop)
        .innerJoin(
          schema.collectionRoute,
          eq(schema.collectionRoute.id, schema.routeStop.routeId),
        )
        .innerJoin(
          schema.zone,
          eq(schema.zone.id, schema.collectionRoute.zoneId),
        )
        .where(and(eq(schema.routeStop.id, input.stopId), input.zoneScope))
        .for('update', { of: schema.routeStop });
      if (!row) throw new NotFoundException('Parada no encontrada');
      const next = cancelStop(row.stop.status, input.reason);
      await tx
        .update(schema.routeStop)
        .set({
          status: next,
          cancelledBy: input.cancelledBy,
          cancelReason: input.reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(schema.routeStop.id, row.stop.id));
    });
  }
}

function stopValues(
  tenantId: string,
  routeId: string,
  collectorId: string,
  sequence: number,
  c: RouteCandidate,
) {
  return {
    tenantId,
    routeId,
    creditId: c.creditId,
    borrowerId: c.borrowerId,
    collectorId,
    sequence,
    clientName: c.clientName,
    address: c.address,
    phone: c.phone,
    lat: c.lat,
    lng: c.lng,
    amountToCollectMinor: c.amountToCollectMinor,
    currency: c.currency,
  };
}

function noteFor(body: ResolveStopInput): string {
  const details = [
    body.reason?.trim(),
    body.promiseDate ? `Promete pagar el ${body.promiseDate}` : undefined,
    body.note?.trim(),
  ].filter(Boolean);
  return [OUTCOME_NOTE[body.outcome], ...details].join(' · ');
}

/** Visita con el nivel de mora al momento (base del reagendamiento por ciclo). */
async function recordVisit(
  tx: Tx,
  tenantId: string,
  stop: StopRow,
  collectorId: string,
  today: string,
): Promise<void> {
  const installments = await tx
    .select({
      dueDate: schema.installment.dueDate,
      amountDueMinor: schema.installment.amountDueMinor,
      paidMinor: schema.installment.paidMinor,
    })
    .from(schema.installment)
    .where(eq(schema.installment.creditId, stop.creditId));
  const overdue = installments.filter(
    (i) => i.dueDate < today && i.paidMinor < i.amountDueMinor,
  );
  const earliest = overdue.map((i) => i.dueDate).sort()[0] ?? null;
  await tx.insert(schema.collectionVisit).values({
    tenantId,
    creditId: stop.creditId,
    borrowerId: stop.borrowerId,
    collectorId,
    overdueCountAtVisit: overdue.length,
    daysOverdueAtVisit: daysSince(earliest, today),
  });
}

async function loadOwnStop(
  tx: Tx,
  stopId: string,
  collectorId: string,
): Promise<StopRow> {
  const [stop] = await tx
    .select()
    .from(schema.routeStop)
    .where(
      and(
        eq(schema.routeStop.id, stopId),
        eq(schema.routeStop.collectorId, collectorId),
      ),
    )
    .for('update');
  if (!stop) throw new NotFoundException('Parada no encontrada');
  return stop;
}

async function zoneInScope(
  tx: Tx,
  zoneId: string,
  zoneScope: SQL | undefined,
): Promise<string> {
  const [zone] = await tx
    .select({ path: schema.zone.path })
    .from(schema.zone)
    .where(and(eq(schema.zone.id, zoneId), zoneScope))
    .limit(1);
  if (!zone) throw new NotFoundException('Zona no encontrada');
  return zone.path;
}

/**
 * Cada cobrador asignado está activo y tiene caja de ruta: la visita puede terminar en cobro en
 * efectivo, y sin caja no puede recibirlo (se valida al despachar, no en la calle).
 */
async function assertCollectorsCanCollect(
  tx: Tx,
  collectorIds: string[],
  currency: string,
): Promise<void> {
  const users = await tx
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(
      and(
        inArray(schema.appUser.id, collectorIds),
        eq(schema.appUser.role, 'COLLECTOR'),
        eq(schema.appUser.active, true),
      ),
    );
  if (users.length !== collectorIds.length) {
    throw new BadRequestException(
      'Alguno de los cobradores no existe o no está activo',
    );
  }
  for (const id of collectorIds) {
    if (!(await findRouteBox(tx, id, currency))) {
      throw new ConflictError(
        'Un cobrador asignado no tiene caja de ruta para recibir efectivo',
        'NO_ROUTE_CASH_BOX',
      );
    }
  }
}

function stopAlreadyOpen(): ConflictError {
  return new ConflictError(
    'Un cliente de la ruta ya tiene una parada abierta',
    'STOP_ALREADY_OPEN',
  );
}

function isOpenStopViolation(err: unknown): boolean {
  const e = err as {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  const code = e.code ?? e.cause?.code;
  const constraint = e.constraint_name ?? e.cause?.constraint_name;
  return code === UNIQUE_VIOLATION && constraint === OPEN_STOP_INDEX;
}
