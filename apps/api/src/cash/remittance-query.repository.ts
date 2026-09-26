import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  carriedDebtMinor,
  remittanceObligation,
  summarizeRemittance,
} from '@preztiaos/domain';
import type {
  MyRemittanceOutput,
  RemittanceBoardRow,
  RemittanceView,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { findRouteBox } from './payment-box-router';
import {
  loadRouteBoxState,
  resolveRemittanceSchedule,
  toRemittanceView,
} from './route-box-state';

interface Page<T> {
  items: T[];
  total: number;
}

interface BoardSqlRow {
  cash_box_id: string;
  cash_box_name: string;
  collector_id: string;
  collector_email: string | null;
  zone_id: string | null;
  zone_name: string | null;
  opening: string | number;
  balance: string | number;
  debt_closed: string | number;
  oldest_collection: Date | string | null;
  open_id: string | null;
  total: string | number;
}

/**
 * Lecturas de la RENDICIÓN del cobrador: su propia vista, el tablero del coordinador y el
 * historial. El estado (obligación, atraso, deuda) lo calculan las mismas reglas del dominio que
 * usan las escrituras, así el cobrador y el coordinador ven el mismo número.
 */
@Injectable()
export class RemittanceQueryRepository {
  async mine(input: {
    tenantId: string;
    collectorId: string;
    currency: string;
    now: Date;
  }): Promise<MyRemittanceOutput> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const schedule = await resolveRemittanceSchedule(tx, input.tenantId);
      const boxId = await findRouteBox(tx, input.collectorId, input.currency);
      if (!boxId) {
        return {
          hasRouteBox: false,
          status: 'UP_TO_DATE',
          dueAt: null,
          lateMinutes: 0,
          cashInHandMinor: 0,
          carriedDebtMinor: 0,
          currency: input.currency,
          deadlineHourLocal: schedule.deadlineHourLocal,
          summary: summarizeRemittance(0, []),
          openRemittance: null,
        };
      }
      const state = await loadRouteBoxState(tx, {
        cashBoxId: boxId,
        collectorId: input.collectorId,
        now: input.now,
        schedule,
      });
      return {
        hasRouteBox: true,
        status: state.obligation.status,
        dueAt: state.obligation.dueAt?.toISOString() ?? null,
        lateMinutes: state.obligation.lateMinutes,
        cashInHandMinor: state.balanceMinor,
        carriedDebtMinor: state.carriedDebtMinor,
        currency: input.currency,
        deadlineHourLocal: schedule.deadlineHourLocal,
        summary: state.summary,
        openRemittance: state.open ? toRemittanceView(state.open) : null,
      };
    });
  }

  /**
   * Una fila por caja de ruta activa dentro del alcance, en UNA consulta (LATERAL por caja: último
   * corte, saldo, cierres de deuda y cobro más antiguo sin rendir). Primero los más atrasados.
   */
  async board(input: {
    tenantId: string;
    currency: string;
    zoneScope: SQL | undefined;
    withDebt: boolean;
    page: number;
    pageSize: number;
    now: Date;
  }): Promise<Page<RemittanceBoardRow>> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const schedule = await resolveRemittanceSchedule(tx, input.tenantId);
      const rows = (await tx.execute(sql`
        WITH boxes AS (
          SELECT b.id AS cash_box_id, b.name AS cash_box_name, b.assigned_to AS collector_id,
                 u.email AS collector_email, b.zone_id, zone.name AS zone_name,
                 COALESCE(lc.closing_balance_minor, 0) AS opening,
                 COALESCE(bal.balance, 0) AS balance,
                 COALESCE(aft.debt_closed, 0) AS debt_closed,
                 aft.oldest_collection,
                 op.id AS open_id
          FROM cash_box b
          -- Sin alias: el predicado de alcance (zoneScopePredicate) referencia "zone"."path".
          LEFT JOIN zone ON zone.id = b.zone_id
          LEFT JOIN app_user u ON u.id = b.assigned_to
          LEFT JOIN LATERAL (
            SELECT r.cut_at, r.closing_balance_minor FROM collector_remittance r
            WHERE r.cash_box_id = b.id AND r.status = 'RECEIVED'
            ORDER BY r.cut_at DESC LIMIT 1
          ) lc ON true
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN t.direction = 'IN' THEN t.amount_minor ELSE -t.amount_minor END) AS balance
            FROM cash_transaction t WHERE t.cash_box_id = b.id
          ) bal ON true
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN t.kind = 'DEBT_CLOSURE' THEN t.amount_minor ELSE 0 END) AS debt_closed,
                   MIN(CASE WHEN t.kind = 'PAYMENT_IN' AND t.direction = 'IN' THEN t.created_at END) AS oldest_collection
            FROM cash_transaction t
            WHERE t.cash_box_id = b.id AND (lc.cut_at IS NULL OR t.created_at > lc.cut_at)
          ) aft ON true
          LEFT JOIN LATERAL (
            SELECT r.id FROM collector_remittance r
            WHERE r.collector_id = b.assigned_to AND r.status = 'SUBMITTED' LIMIT 1
          ) op ON true
          WHERE b.type = 'CASH' AND b.active AND b.assigned_to IS NOT NULL
            AND b.currency = ${input.currency}
            AND ${input.zoneScope ?? sql`true`}
        )
        SELECT *, count(*) OVER () AS total FROM boxes
        WHERE ${input.withDebt ? sql`opening - debt_closed > 0` : sql`true`}
        ORDER BY (open_id IS NOT NULL) ASC, oldest_collection ASC NULLS LAST, collector_email
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      `)) as unknown as BoardSqlRow[];

      const openById = await loadRemittancesById(
        tx,
        rows.map((r) => r.open_id).filter((id): id is string => id !== null),
      );
      const items = rows.map((r): RemittanceBoardRow => {
        const oldest = r.oldest_collection
          ? new Date(r.oldest_collection)
          : null;
        const obligation = remittanceObligation({
          hasOpenSubmission: r.open_id !== null,
          oldestUnremittedCollectionAt: oldest,
          now: input.now,
          ...schedule,
        });
        return {
          collectorId: r.collector_id,
          collectorEmail: r.collector_email,
          cashBoxId: r.cash_box_id,
          cashBoxName: r.cash_box_name,
          zoneId: r.zone_id,
          zoneName: r.zone_name,
          status: obligation.status,
          dueAt: obligation.dueAt?.toISOString() ?? null,
          lateMinutes: obligation.lateMinutes,
          cashInHandMinor: Number(r.balance),
          carriedDebtMinor: carriedDebtMinor(
            Number(r.opening),
            Number(r.debt_closed),
          ),
          currency: input.currency,
          openRemittance: r.open_id ? (openById.get(r.open_id) ?? null) : null,
        };
      });
      return { items, total: Number(rows[0]?.total ?? 0) };
    });
  }

  /** Historial paginado (más reciente primero), acotado al alcance y opcionalmente a un cobrador. */
  async history(input: {
    tenantId: string;
    zoneScope: SQL | undefined;
    collectorId?: string;
    page: number;
    pageSize: number;
  }): Promise<Page<RemittanceView>> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = and(
        input.collectorId
          ? eq(schema.collectorRemittance.collectorId, input.collectorId)
          : undefined,
        input.zoneScope,
      );
      const rows = await tx
        .select({ remittance: schema.collectorRemittance })
        .from(schema.collectorRemittance)
        .leftJoin(
          schema.zone,
          eq(schema.zone.id, schema.collectorRemittance.zoneId),
        )
        .where(where)
        .orderBy(desc(schema.collectorRemittance.submittedAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await tx
        .select({ value: count() })
        .from(schema.collectorRemittance)
        .leftJoin(
          schema.zone,
          eq(schema.zone.id, schema.collectorRemittance.zoneId),
        )
        .where(where);
      return {
        items: rows.map((r) => toRemittanceView(r.remittance)),
        total: Number(total?.value ?? 0),
      };
    });
  }
}

async function loadRemittancesById(
  tx: Tx,
  ids: string[],
): Promise<Map<string, RemittanceView>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.collectorRemittance)
    .where(inArray(schema.collectorRemittance.id, ids));
  return new Map(rows.map((row) => [row.id, toRemittanceView(row)]));
}
