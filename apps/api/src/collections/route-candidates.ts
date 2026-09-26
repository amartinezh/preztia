import { inArray, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { overdueAmountMinor, type DueInstallment } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/** Crédito candidato a parada de ruta, con lo que el coordinador y la vista mínima necesitan. */
export interface RouteCandidate {
  readonly creditId: string;
  readonly borrowerId: string;
  readonly clientName: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly currency: string;
  readonly overdueCount: number;
  readonly lastVisitOverdueCount: number | null;
  readonly amountToCollectMinor: number;
  /** ¿Ya tiene una parada abierta? */
  readonly alreadyDispatched: boolean;
}

interface CandidateRow {
  credit_id: string;
  borrower_id: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  currency: string;
  overdue_count: number | string;
  last_visit_overdue: number | null;
  already_dispatched: boolean;
}

/**
 * Créditos ACTIVOS de la zona (y sus subzonas) con su mora, la última visita y si ya tienen parada
 * abierta; el monto a cobrar lo calcula la regla del dominio (`overdueAmountMinor`) sobre las
 * cuotas. Dos consultas por lote (sin N+1). `creditIds` acota a los elegidos al despachar.
 */
export async function loadRouteCandidates(
  tx: Tx,
  input: { zonePath: string; today: string; creditIds?: readonly string[] },
): Promise<RouteCandidate[]> {
  const creditFilter = input.creditIds
    ? sql`AND c.id IN (${sql.join(
        input.creditIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const overdue = sql`i.due_date < ${input.today} AND i.paid_minor < i.amount_due_minor`;
  const rows = (await tx.execute(sql`
    SELECT c.id::text AS credit_id, c.borrower_id::text AS borrower_id,
           b.first_name, b.last_name, b.address, b.phone, b.lat, b.lng, c.currency,
           COALESCE(SUM(CASE WHEN ${overdue} THEN 1 ELSE 0 END), 0)::int AS overdue_count,
           lv.overdue_count_at_visit AS last_visit_overdue,
           EXISTS (
             SELECT 1 FROM route_stop s
             WHERE s.credit_id = c.id AND s.status IN ('ASSIGNED', 'SEEN')
           ) AS already_dispatched
    FROM credit c
    JOIN zone z ON z.id = c.zone_id
    JOIN borrower b ON b.id = c.borrower_id
    LEFT JOIN installment i ON i.credit_id = c.id
    LEFT JOIN LATERAL (
      SELECT v.overdue_count_at_visit FROM collection_visit v
      WHERE v.credit_id = c.id ORDER BY v.visited_at DESC LIMIT 1
    ) lv ON true
    WHERE c.status = 'ACTIVE' AND z.path <@ ${input.zonePath}::ltree ${creditFilter}
    GROUP BY c.id, c.borrower_id, b.first_name, b.last_name, b.address, b.phone, b.lat, b.lng,
             c.currency, lv.overdue_count_at_visit
  `)) as unknown as CandidateRow[];
  if (rows.length === 0) return [];

  const installments = await tx
    .select({
      creditId: schema.installment.creditId,
      dueDate: schema.installment.dueDate,
      amountDueMinor: schema.installment.amountDueMinor,
      paidMinor: schema.installment.paidMinor,
    })
    .from(schema.installment)
    .where(
      inArray(
        schema.installment.creditId,
        rows.map((r) => r.credit_id),
      ),
    );
  const byCredit = new Map<string, DueInstallment[]>();
  for (const i of installments) {
    const list = byCredit.get(i.creditId) ?? [];
    list.push(i);
    byCredit.set(i.creditId, list);
  }

  return rows.map((r) => ({
    creditId: r.credit_id,
    borrowerId: r.borrower_id,
    clientName: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    address: r.address,
    phone: r.phone,
    lat: r.lat,
    lng: r.lng,
    currency: r.currency,
    overdueCount: Number(r.overdue_count),
    lastVisitOverdueCount: r.last_visit_overdue ?? null,
    amountToCollectMinor: overdueAmountMinor(
      byCredit.get(r.credit_id) ?? [],
      input.today,
    ),
    alreadyDispatched: r.already_dispatched,
  }));
}
