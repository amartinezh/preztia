import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { isStopOpen, needsVisit } from '@preztiaos/domain';
import type {
  MyRouteStop,
  ProposedStop,
  ReviewerStop,
  RouteDetail,
  RouteSummary,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { tenantToday } from '../tenant-config/tenant-timezone';
import { OsrmRouteOptimizer } from './osrm-route-optimizer';
import { resolveOverdueThreshold } from './critical-overdue-threshold';
import { loadRouteCandidates, type RouteCandidate } from './route-candidates';

type StopRow = typeof schema.routeStop.$inferSelect;

/** Estados de una parada abierta (la única que da acceso a la vista mínima). */
const OPEN_STATUSES = ['ASSIGNED', 'SEEN'] as const;

/**
 * Lecturas de las ÓRDENES DE RUTA. La propuesta usa la MISMA regla del dominio que las visitas
 * (`needsVisit`) y el optimizador OSRM; la vista del cobrador sale solo de la copia guardada en la
 * parada y se vacía de contacto al cerrarla (I11). Todo acotado por alcance y sin N+1.
 */
@Injectable()
export class CollectionRouteQueryRepository {
  constructor(private readonly optimizer: OsrmRouteOptimizer) {}

  async proposal(input: {
    tenantId: string;
    zoneId: string;
    zoneScope: SQL | undefined;
  }): Promise<{ items: ProposedStop[]; degraded: boolean }> {
    const { candidates } = await withTenantTxFor(input.tenantId, async (tx) => {
      const [zone] = await tx
        .select({ path: schema.zone.path })
        .from(schema.zone)
        .where(and(eq(schema.zone.id, input.zoneId), input.zoneScope))
        .limit(1);
      if (!zone) throw new NotFoundException('Zona no encontrada');
      const threshold = await resolveOverdueThreshold(tx, input.tenantId);
      const today = await tenantToday(tx, input.tenantId);
      const all = await loadRouteCandidates(tx, { zonePath: zone.path, today });
      return {
        candidates: all.filter((c) =>
          needsVisit({
            overdueCount: c.overdueCount,
            threshold,
            lastVisitOverdueCount: c.lastVisitOverdueCount,
          }),
        ),
      };
    });
    // El optimizador (HTTP externo) corre FUERA de la transacción.
    const { ordered, degraded } = await this.orderByTrip(candidates);
    return { items: ordered.map(toProposed), degraded };
  }

  async listRoutes(input: {
    tenantId: string;
    zoneScope: SQL | undefined;
    currency: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: RouteSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const routes = await tx
        .select({ route: schema.collectionRoute, zoneName: schema.zone.name })
        .from(schema.collectionRoute)
        .innerJoin(
          schema.zone,
          eq(schema.zone.id, schema.collectionRoute.zoneId),
        )
        .where(input.zoneScope)
        .orderBy(desc(schema.collectionRoute.dispatchedAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await tx
        .select({ value: count() })
        .from(schema.collectionRoute)
        .innerJoin(
          schema.zone,
          eq(schema.zone.id, schema.collectionRoute.zoneId),
        )
        .where(input.zoneScope);
      const progress = await progressOf(
        tx,
        routes.map((r) => r.route.id),
      );
      return {
        items: routes.map((r) =>
          toSummary(
            r.route,
            r.zoneName,
            progress.get(r.route.id),
            input.currency,
          ),
        ),
        total: Number(total?.value ?? 0),
      };
    });
  }

  async getRoute(input: {
    tenantId: string;
    routeId: string;
    zoneScope: SQL | undefined;
    currency: string;
  }): Promise<RouteDetail> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ route: schema.collectionRoute, zoneName: schema.zone.name })
        .from(schema.collectionRoute)
        .innerJoin(
          schema.zone,
          eq(schema.zone.id, schema.collectionRoute.zoneId),
        )
        .where(
          and(eq(schema.collectionRoute.id, input.routeId), input.zoneScope),
        )
        .limit(1);
      if (!row) throw new NotFoundException('Ruta no encontrada');
      const stops = await tx
        .select({
          stop: schema.routeStop,
          collectorEmail: schema.appUser.email,
        })
        .from(schema.routeStop)
        .leftJoin(
          schema.appUser,
          eq(schema.appUser.id, schema.routeStop.collectorId),
        )
        .where(eq(schema.routeStop.routeId, input.routeId))
        .orderBy(asc(schema.routeStop.sequence));
      const progress = await progressOf(tx, [input.routeId]);
      return {
        ...toSummary(
          row.route,
          row.zoneName,
          progress.get(input.routeId),
          input.currency,
        ),
        stops: stops.map((s) => toReviewerStop(s.stop, s.collectorEmail)),
      };
    });
  }

  /** Parada vista por el coordinador (para responder tras cancelarla). */
  async getReviewerStop(input: {
    tenantId: string;
    stopId: string;
  }): Promise<ReviewerStop> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          stop: schema.routeStop,
          collectorEmail: schema.appUser.email,
        })
        .from(schema.routeStop)
        .leftJoin(
          schema.appUser,
          eq(schema.appUser.id, schema.routeStop.collectorId),
        )
        .where(eq(schema.routeStop.id, input.stopId))
        .limit(1);
      if (!row) throw new NotFoundException('Parada no encontrada');
      return toReviewerStop(row.stop, row.collectorEmail);
    });
  }

  /** Paradas del cobrador: abiertas (en orden de visita) o su historial (más recientes primero). */
  async myStops(input: {
    tenantId: string;
    collectorId: string;
    status: 'open' | 'done';
    page: number;
    pageSize: number;
  }): Promise<{ items: MyRouteStop[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = and(
        eq(schema.routeStop.collectorId, input.collectorId),
        input.status === 'open'
          ? inArray(schema.routeStop.status, [...OPEN_STATUSES])
          : sql`${schema.routeStop.status} NOT IN ('ASSIGNED', 'SEEN')`,
      );
      const rows = await tx
        .select({
          stop: schema.routeStop,
          serviceDate: schema.collectionRoute.serviceDate,
        })
        .from(schema.routeStop)
        .innerJoin(
          schema.collectionRoute,
          eq(schema.collectionRoute.id, schema.routeStop.routeId),
        )
        .where(where)
        .orderBy(
          ...(input.status === 'open'
            ? [
                asc(schema.routeStop.dispatchedAt),
                asc(schema.routeStop.sequence),
              ]
            : [desc(schema.routeStop.updatedAt)]),
        )
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await tx
        .select({ value: count() })
        .from(schema.routeStop)
        .where(where);
      return {
        items: rows.map((r) => toMyStop(r.stop, r.serviceDate)),
        total: Number(total?.value ?? 0),
      };
    });
  }

  async myStop(input: {
    tenantId: string;
    collectorId: string;
    stopId: string;
  }): Promise<MyRouteStop> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          stop: schema.routeStop,
          serviceDate: schema.collectionRoute.serviceDate,
        })
        .from(schema.routeStop)
        .innerJoin(
          schema.collectionRoute,
          eq(schema.collectionRoute.id, schema.routeStop.routeId),
        )
        .where(
          and(
            eq(schema.routeStop.id, input.stopId),
            eq(schema.routeStop.collectorId, input.collectorId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException('Parada no encontrada');
      return toMyStop(row.stop, row.serviceDate);
    });
  }

  /**
   * Recorrido: los clientes con coordenadas se ordenan con OSRM partiendo del de mayor mora; los
   * que no tienen coordenadas van al final, por mora. Si OSRM falla, orden por mora (degradado).
   */
  private async orderByTrip(
    candidates: RouteCandidate[],
  ): Promise<{ ordered: RouteCandidate[]; degraded: boolean }> {
    const byOverdue = [...candidates].sort(
      (a, b) => b.overdueCount - a.overdueCount,
    );
    const located = byOverdue.filter((c) => c.lat !== null && c.lng !== null);
    const unlocated = byOverdue.filter((c) => c.lat === null || c.lng === null);
    if (located.length < 2) return { ordered: byOverdue, degraded: false };
    const [first, ...rest] = located;
    const trip = await this.optimizer.optimize({
      start: { latitude: first.lat!, longitude: first.lng! },
      stops: rest.map((c) => ({ latitude: c.lat!, longitude: c.lng! })),
    });
    return {
      ordered: [first, ...trip.order.map((i) => rest[i]), ...unlocated],
      degraded: trip.degraded,
    };
  }
}

interface Progress {
  total: number;
  open: number;
  resolved: number;
  collected: number;
}

async function progressOf(
  tx: Tx,
  routeIds: string[],
): Promise<Map<string, Progress>> {
  if (routeIds.length === 0) return new Map();
  const rows = await tx
    .select({
      routeId: schema.routeStop.routeId,
      total: sql<string>`count(*)`,
      open: sql<string>`count(*) FILTER (WHERE ${schema.routeStop.status} IN ('ASSIGNED', 'SEEN'))`,
      resolved: sql<string>`count(*) FILTER (WHERE ${schema.routeStop.status} = 'RESOLVED')`,
      collected: sql<string>`COALESCE(SUM(${schema.routeStop.collectedMinor}), 0)`,
    })
    .from(schema.routeStop)
    .where(inArray(schema.routeStop.routeId, routeIds))
    .groupBy(schema.routeStop.routeId);
  return new Map(
    rows.map((r) => [
      r.routeId,
      {
        total: Number(r.total),
        open: Number(r.open),
        resolved: Number(r.resolved),
        collected: Number(r.collected),
      },
    ]),
  );
}

function toSummary(
  route: typeof schema.collectionRoute.$inferSelect,
  zoneName: string | null,
  progress: Progress | undefined,
  currency: string,
): RouteSummary {
  return {
    id: route.id,
    zoneId: route.zoneId,
    zoneName,
    serviceDate: route.serviceDate,
    dispatchedAt: route.dispatchedAt.toISOString(),
    createdBy: route.createdBy,
    totalStops: progress?.total ?? 0,
    openStops: progress?.open ?? 0,
    resolvedStops: progress?.resolved ?? 0,
    collectedMinor: progress?.collected ?? 0,
    currency,
  };
}

function toProposed(c: RouteCandidate): ProposedStop {
  return {
    creditId: c.creditId,
    borrowerId: c.borrowerId,
    clientName: c.clientName,
    address: c.address,
    phone: c.phone,
    lat: c.lat,
    lng: c.lng,
    overdueCount: c.overdueCount,
    amountToCollectMinor: c.amountToCollectMinor,
    currency: c.currency,
    alreadyDispatched: c.alreadyDispatched,
  };
}

function toReviewerStop(
  s: StopRow,
  collectorEmail: string | null,
): ReviewerStop {
  return {
    id: s.id,
    sequence: s.sequence,
    status: s.status,
    collectorId: s.collectorId,
    collectorEmail,
    clientName: s.clientName,
    address: s.address,
    amountToCollectMinor: s.amountToCollectMinor,
    currency: s.currency,
    dispatchedAt: s.dispatchedAt.toISOString(),
    seenAt: s.seenAt?.toISOString() ?? null,
    outcome: s.outcome,
    collectedMinor: s.collectedMinor,
    outcomeReason: s.outcomeReason,
    promiseDate: s.promiseDate,
    note: s.note,
    resolvedAt: s.resolvedAt?.toISOString() ?? null,
    cancelReason: s.cancelReason,
  };
}

/** Vista del cobrador: al cerrarse la parada pierde dirección, teléfono y mapa del cliente (I11). */
function toMyStop(s: StopRow, serviceDate: string): MyRouteStop {
  const open = isStopOpen(s.status);
  return {
    id: s.id,
    routeId: s.routeId,
    serviceDate,
    sequence: s.sequence,
    status: s.status,
    clientName: s.clientName,
    address: open ? s.address : null,
    phone: open ? s.phone : null,
    lat: open ? s.lat : null,
    lng: open ? s.lng : null,
    amountToCollectMinor: s.amountToCollectMinor,
    currency: s.currency,
    dispatchedAt: s.dispatchedAt.toISOString(),
    outcome: s.outcome,
    collectedMinor: s.collectedMinor,
    resolvedAt: s.resolvedAt?.toISOString() ?? null,
  };
}
