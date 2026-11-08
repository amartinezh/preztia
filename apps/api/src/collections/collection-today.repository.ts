import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { businessDateOf } from '@preztiaos/domain';
import type {
  CollectionTodayItem,
  CollectionTodayStatus,
  ListCollectionTodayOutput,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import {
  businessDayBoundsIn,
  resolveTenantTimeZone,
} from '../tenant-config/tenant-timezone';
import { daysSince } from './critical-clients.repository';

// Fila cruda del agregado por crédito ACTIVE de los clientes asignados al cobrador.
interface TodayRow {
  credit_id: string;
  borrower_id: string;
  first_name: string | null;
  last_name: string | null;
  national_id: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  currency: string;
  installment_value: number | string | null;
  due_today: number | string;
  outstanding: number | string;
  overdue_count: number | string;
  earliest_overdue: string | null;
  paid_today: number | string;
  last_payment_at: string | null;
  open_stop_id: string | null;
  status: CollectionTodayStatus;
  total: number | string;
}

interface SummaryRow {
  expected: number | string;
  collected: number | string;
  pending_count: number | string;
  paid_count: number | string;
  clients_count: number | string;
}

/**
 * Read model de "MIS COBROS DE HOY": la lista OPERATIVA del cobrador. A diferencia de las visitas
 * (solo clientes con mora ≥ umbral), aquí están TODOS los créditos ACTIVE de sus clientes asignados
 * (`collector_client`), con lo que debe cobrar hoy, lo que ya cobró hoy, el saldo y la parada de
 * ruta abierta si la hay. Es el camino para abonar al cliente al día. "Hoy" es el día de negocio en
 * la zona horaria de la EMPRESA (ADR #46). Solo lectura bajo RLS; el alcance por cobrador es authZ
 * de aplicación (el JOIN con `collector_client`).
 *
 * Invariantes del estado por fila:
 *  - PENDING     ⇔ dueTodayMinor > 0 (hay cuota vencida hasta hoy inclusive sin pagar).
 *  - PAID_TODAY  ⇔ dueTodayMinor = 0 ∧ paidTodayMinor > 0.
 *  - UP_TO_DATE  ⇔ dueTodayMinor = 0 ∧ paidTodayMinor = 0.
 */
@Injectable()
export class CollectionTodayRepository {
  async list(input: {
    tenantId: string;
    collectorId: string;
    currency: string;
    page: number;
    pageSize: number;
    q?: string;
    status?: CollectionTodayStatus;
  }): Promise<ListCollectionTodayOutput> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const timeZone = await resolveTenantTimeZone(tx, input.tenantId);
      const today = businessDateOf(new Date(), timeZone);
      const { start: dayStart, end: dayEnd } = businessDayBoundsIn(
        today,
        timeZone,
      );

      // Los instantes viajan como ISO (el SQL crudo no serializa `Date`) y se castean en la consulta.
      const base = this.aggregate(
        input.collectorId,
        today,
        dayStart.toISOString(),
        dayEnd.toISOString(),
      );
      const filters: SQL[] = [];
      if (input.q) {
        const like = `%${input.q}%`;
        filters.push(sql`(
          (first_name || ' ' || last_name) ILIKE ${like}
          OR national_id ILIKE ${like}
          OR phone ILIKE ${like}
        )`);
      }
      if (input.status) filters.push(sql`status = ${input.status}`);
      const where = filters.length
        ? sql`WHERE ${sql.join(filters, sql` AND `)}`
        : sql``;
      const offset = (input.page - 1) * input.pageSize;

      // Los que deben cobrarse hoy primero (más mora arriba), luego los cobrados hoy, luego al día.
      const rows = (await tx.execute(sql`
        WITH rows AS (${base})
        SELECT *, COUNT(*) OVER() AS total
        FROM rows
        ${where}
        ORDER BY
          CASE status WHEN 'PENDING' THEN 0 WHEN 'PAID_TODAY' THEN 1 ELSE 2 END,
          overdue_count DESC,
          first_name, last_name
        LIMIT ${input.pageSize} OFFSET ${offset}
      `)) as unknown as TodayRow[];

      // El resumen es de TODA la cartera del cobrador (no de la página ni del filtro).
      const [summary] = (await tx.execute(sql`
        WITH rows AS (${base})
        SELECT
          COALESCE(SUM(due_today), 0)::bigint                       AS expected,
          COALESCE(SUM(paid_today), 0)::bigint                      AS collected,
          COUNT(*) FILTER (WHERE status = 'PENDING')::int           AS pending_count,
          COUNT(*) FILTER (WHERE status = 'PAID_TODAY')::int        AS paid_count,
          COUNT(*)::int                                             AS clients_count
        FROM rows
      `)) as unknown as SummaryRow[];

      return {
        date: today,
        currency: input.currency,
        summary: {
          expectedMinor: Number(summary?.expected ?? 0),
          collectedMinor: Number(summary?.collected ?? 0),
          pendingCount: Number(summary?.pending_count ?? 0),
          paidCount: Number(summary?.paid_count ?? 0),
          clientsCount: Number(summary?.clients_count ?? 0),
        },
        items: rows.map((row) => this.toItem(row, today)),
        page: input.page,
        pageSize: input.pageSize,
        total: Number(rows[0]?.total ?? 0),
      };
    });
  }

  // Agregado por crédito. `due_today` incluye las cuotas que vencen HOY y las vencidas antes.
  private aggregate(
    collectorId: string,
    today: string,
    dayStartIso: string,
    dayEndIso: string,
  ): SQL {
    const unpaid = sql`(i.amount_due_minor - i.paid_minor)`;
    const overdueFilter = sql`i.due_date < ${today} AND i.paid_minor < i.amount_due_minor`;
    return sql`
      SELECT
        c.id::text          AS credit_id,
        c.borrower_id::text AS borrower_id,
        b.first_name        AS first_name,
        b.last_name         AS last_name,
        b.national_id       AS national_id,
        b.phone             AS phone,
        b.lat               AS lat,
        b.lng               AS lng,
        c.currency          AS currency,
        MIN(CASE WHEN i.seq = 1 THEN i.amount_due_minor END)::bigint                    AS installment_value,
        COALESCE(SUM(CASE WHEN i.due_date <= ${today} THEN ${unpaid} ELSE 0 END), 0)::bigint AS due_today,
        COALESCE(SUM(${unpaid}), 0)::bigint                                             AS outstanding,
        COALESCE(SUM(CASE WHEN ${overdueFilter} THEN 1 ELSE 0 END), 0)::int             AS overdue_count,
        MIN(CASE WHEN ${overdueFilter} THEN i.due_date END)::text                       AS earliest_overdue,
        COALESCE(pt.paid_today, 0)::bigint                                              AS paid_today,
        lp.last_payment_at::text                                                        AS last_payment_at,
        os.id::text                                                                     AS open_stop_id,
        CASE
          WHEN COALESCE(SUM(CASE WHEN i.due_date <= ${today} THEN ${unpaid} ELSE 0 END), 0) > 0 THEN 'PENDING'
          WHEN COALESCE(pt.paid_today, 0) > 0 THEN 'PAID_TODAY'
          ELSE 'UP_TO_DATE'
        END                                                                             AS status
      FROM credit c
      JOIN collector_client cc
        ON cc.borrower_id = c.borrower_id AND cc.collector_id = ${collectorId}
      JOIN borrower b ON b.id = c.borrower_id
      LEFT JOIN installment i ON i.credit_id = c.id
      LEFT JOIN LATERAL (
        SELECT SUM(p.amount_minor) AS paid_today
        FROM payment p
        WHERE p.credit_id = c.id AND p.status = 'VERIFIED'
          AND p.paid_at >= ${dayStartIso}::timestamptz AND p.paid_at < ${dayEndIso}::timestamptz
      ) pt ON true
      LEFT JOIN LATERAL (
        SELECT MAX(p.paid_at) AS last_payment_at
        FROM payment p
        WHERE p.credit_id = c.id AND p.status = 'VERIFIED'
      ) lp ON true
      LEFT JOIN LATERAL (
        SELECT s.id
        FROM route_stop s
        WHERE s.credit_id = c.id AND s.collector_id = ${collectorId}
          AND s.status IN ('ASSIGNED', 'SEEN')
        LIMIT 1
      ) os ON true
      WHERE c.status = 'ACTIVE'
      GROUP BY c.id, c.borrower_id, b.first_name, b.last_name, b.national_id, b.phone, b.lat, b.lng,
               c.currency, pt.paid_today, lp.last_payment_at, os.id
    `;
  }

  private toItem(row: TodayRow, today: string): CollectionTodayItem {
    return {
      creditId: row.credit_id,
      borrowerId: row.borrower_id,
      borrowerName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
      nationalId: row.national_id,
      phone: row.phone,
      latitude: row.lat,
      longitude: row.lng,
      currency: row.currency,
      installmentValueMinor: Number(row.installment_value ?? 0),
      dueTodayMinor: Number(row.due_today),
      outstandingMinor: Number(row.outstanding),
      overdueCount: Number(row.overdue_count),
      daysOverdue: daysSince(row.earliest_overdue, today),
      paidTodayMinor: Number(row.paid_today),
      lastPaymentAt: row.last_payment_at,
      openRouteStopId: row.open_stop_id,
      status: row.status,
    };
  }
}

/** Expuesto para pruebas: clasificación pura de una fila (espejo del CASE de la consulta). */
export function classifyToday(
  dueTodayMinor: number,
  paidTodayMinor: number,
): CollectionTodayStatus {
  if (dueTodayMinor > 0) return 'PENDING';
  if (paidTodayMinor > 0) return 'PAID_TODAY';
  return 'UP_TO_DATE';
}

export type { Tx };
