import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { isVisitedInCurrentCycle, needsVisit } from '@preztiaos/domain';
import type {
  CreditOverdueSnapshot,
  VisitOverdueReader,
} from '@preztiaos/application';
import type { VisitStatus, VisitTarget } from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { daysSince } from './critical-clients.repository';
import { resolveOverdueThreshold } from './critical-overdue-threshold';

// Fila cruda del agregado por crédito (mora + última visita + última observación).
interface VisitRow {
  credit_id: string;
  borrower_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  zone_path: string | null;
  currency: string;
  overdue_count: number | string;
  earliest_overdue: string | null;
  total_due: number | string;
  total_paid: number | string;
  last_visit_overdue: number | null;
  last_visit_at: string | null;
  latest_note_at: string | null;
}

/**
 * Read model de VISITAS DE COBRO del cobrador. Lista los créditos ACTIVE de sus clientes asignados
 * (`collector_client`) con la mora agregada, la última visita y la observación más reciente, y los
 * clasifica en Pendientes / Visitados con la MISMA regla del dominio (`needsVisit`), de modo que la
 * lista y el agendamiento no puedan divergir. Solo lectura, bajo rol `app` + RLS (todo en
 * `withTenantTxFor`); el alcance por cobrador es authZ de aplicación (RLS solo aísla por tenant).
 * También implementa `VisitOverdueReader` (snapshot de un crédito) para los casos de uso de
 * escritura.
 */
@Injectable()
export class VisitTargetsRepository implements VisitOverdueReader {
  /** Umbral vigente de cuotas vencidas del tenant (config, con fallback env → 3). */
  async resolveThreshold(tenantId: string): Promise<number> {
    return withTenantTxFor(tenantId, (tx) =>
      resolveOverdueThreshold(tx, tenantId),
    );
  }

  async list(input: {
    tenantId: string;
    collectorId: string;
    status: VisitStatus;
  }): Promise<{ threshold: number; items: VisitTarget[] }> {
    const today = new Date().toISOString().slice(0, 10);

    return withTenantTxFor(input.tenantId, async (tx) => {
      const threshold = await resolveOverdueThreshold(tx, input.tenantId);
      const rows = await this.queryRows(tx, today, input.collectorId, null);

      const items = rows
        // Clasifica con la MISMA regla del dominio para que lista y agendamiento no divergan.
        .filter((row) => {
          const state = {
            overdueCount: Number(row.overdue_count),
            threshold,
            lastVisitOverdueCount: row.last_visit_overdue ?? null,
          };
          return input.status === 'pending'
            ? needsVisit(state)
            : isVisitedInCurrentCycle(state);
        })
        .map((row) => this.toTarget(row, today))
        // Más urgentes primero (mayor mora arriba).
        .sort((a, b) => b.overdueCount - a.overdueCount);

      return { threshold, items };
    });
  }

  async findForCollector(input: {
    tenantId: string;
    collectorId: string;
    creditId: string;
  }): Promise<CreditOverdueSnapshot | null> {
    const today = new Date().toISOString().slice(0, 10);
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await this.queryRows(
        tx,
        today,
        input.collectorId,
        input.creditId,
      );
      if (!row) return null;
      return {
        creditId: row.credit_id,
        borrowerId: row.borrower_id,
        overdueCount: Number(row.overdue_count),
        daysOverdue: daysSince(row.earliest_overdue, today),
      };
    });
  }

  // Mapea una fila cruda al objetivo de visita del contrato.
  private toTarget(row: VisitRow, today: string): VisitTarget {
    const hasFreshObservation =
      row.latest_note_at !== null &&
      (row.last_visit_at === null ||
        Date.parse(row.latest_note_at) > Date.parse(row.last_visit_at));
    return {
      creditId: row.credit_id,
      borrowerId: row.borrower_id,
      borrowerName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
      phone: row.phone,
      latitude: row.lat,
      longitude: row.lng,
      overdueCount: Number(row.overdue_count),
      daysOverdue: daysSince(row.earliest_overdue, today),
      outstandingMinor: Number(row.total_due) - Number(row.total_paid),
      currency: row.currency,
      zonePath: row.zone_path,
      lastVisitAt: row.last_visit_at,
      hasFreshObservation,
    };
  }

  // Agregado por crédito ACTIVE de los clientes asignados al cobrador. Con `creditId` filtra uno.
  private async queryRows(
    tx: Tx,
    today: string,
    collectorId: string,
    creditId: string | null,
  ): Promise<VisitRow[]> {
    const creditFilter = creditId ? sql`AND c.id = ${creditId}` : sql``;
    const overdueFilter = sql`i.due_date < ${today} AND i.paid_minor < i.amount_due_minor`;
    return (await tx.execute(sql`
      SELECT
        c.id::text          AS credit_id,
        c.borrower_id::text AS borrower_id,
        b.first_name        AS first_name,
        b.last_name         AS last_name,
        b.phone             AS phone,
        b.lat               AS lat,
        b.lng               AS lng,
        z.path::text        AS zone_path,
        c.currency          AS currency,
        COALESCE(SUM(CASE WHEN ${overdueFilter} THEN 1 ELSE 0 END), 0)::int AS overdue_count,
        MIN(CASE WHEN ${overdueFilter} THEN i.due_date END)::text           AS earliest_overdue,
        COALESCE(SUM(i.amount_due_minor), 0)::bigint AS total_due,
        COALESCE(SUM(i.paid_minor), 0)::bigint       AS total_paid,
        lv.overdue_count_at_visit AS last_visit_overdue,
        lv.visited_at::text       AS last_visit_at,
        ln.created_at::text       AS latest_note_at
      FROM credit c
      JOIN collector_client cc
        ON cc.borrower_id = c.borrower_id AND cc.collector_id = ${collectorId}
      JOIN borrower b ON b.id = c.borrower_id
      LEFT JOIN zone z ON z.id = c.zone_id
      LEFT JOIN installment i ON i.credit_id = c.id
      LEFT JOIN LATERAL (
        SELECT v.overdue_count_at_visit, v.visited_at
        FROM collection_visit v
        WHERE v.credit_id = c.id
        ORDER BY v.visited_at DESC
        LIMIT 1
      ) lv ON true
      LEFT JOIN LATERAL (
        SELECT n.created_at
        FROM collection_note n
        WHERE n.credit_id = c.id
        ORDER BY n.created_at DESC
        LIMIT 1
      ) ln ON true
      WHERE c.status = 'ACTIVE' ${creditFilter}
      GROUP BY c.id, c.borrower_id, b.first_name, b.last_name, b.phone, b.lat, b.lng,
               z.path, c.currency, lv.overdue_count_at_visit, lv.visited_at, ln.created_at
    `)) as unknown as VisitRow[];
  }
}
