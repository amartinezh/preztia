import { sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  settlementSettingsOf,
  type CashBoxType,
  type CashTxDirection,
  type CollectorActivity,
  type CashTxKind,
  type DebtClosureType,
  type OperationalSettings,
  type PortfolioByZone,
  type SettlementBoxInput,
  type SettlementCollectorRef,
  type SettlementFlow,
  type SettlementSettings,
  type SettlementZoneRef,
} from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/** Rango de la liquidación: días de negocio [start, end) y sus instantes de corte [startsAt, endsAt). */
export interface SettlementRange {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface SettlementInputs {
  readonly boxes: SettlementBoxInput[];
  readonly flows: SettlementFlow[];
  readonly zones: SettlementZoneRef[];
  readonly collectors: SettlementCollectorRef[];
  readonly portfolio: PortfolioByZone[];
  readonly activity: CollectorActivity[];
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
// Las columnas de texto/uuid llegan como string (o null) desde postgres-js.
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Configuración de liquidación del tenant (ajustes operativos con sus valores por defecto). */
export async function readSettlementSettings(
  tx: Tx,
  tenantId: string,
): Promise<SettlementSettings> {
  const rows = (await tx.execute(sql`
    SELECT operational_settings AS settings FROM tenant_config WHERE tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ settings: Partial<OperationalSettings> | null }>;
  return settlementSettingsOf({
    ...DEFAULT_OPERATIONAL_SETTINGS,
    ...(rows[0]?.settings ?? {}),
  });
}

/** Instante del primer asiento del libro (para reconstruir la historia desde el principio). */
export async function readFirstActivity(tx: Tx): Promise<Date | null> {
  const rows = (await tx.execute(
    sql`SELECT min(created_at) AS first FROM cash_transaction`,
  )) as unknown as Row[];
  const first = rows[0]?.first;
  return first ? new Date(first as string) : null;
}

/**
 * Insumos del dominio para el rango: saldo inicial por caja (Σ antes del corte de inicio),
 * movimientos agregados del rango, zonas, cobradores con caja de ruta y métricas de cartera por
 * zona. Todo agregado en SQL (sin N+1); RLS acota el tenant.
 */
export async function readSettlementInputs(
  tx: Tx,
  range: SettlementRange,
): Promise<SettlementInputs> {
  const [boxes, flows, zones, collectors, portfolio, activity] = [
    await readBoxes(tx, range.startsAt),
    await readFlows(tx, range),
    await readZones(tx),
    await readCollectors(tx),
    await readPortfolio(tx, range),
    await readCollectorActivity(tx, range),
  ];
  return { boxes, flows, zones, collectors, portfolio, activity };
}

async function readBoxes(
  tx: Tx,
  startsAt: Date,
): Promise<SettlementBoxInput[]> {
  const rows = (await tx.execute(sql`
    SELECT b.id, b.name, b.type, b.zone_id, z.path::text AS zone_path, b.assigned_to,
           COALESCE((
             SELECT SUM(CASE WHEN t.direction = 'IN' THEN t.amount_minor ELSE -t.amount_minor END)
             FROM cash_transaction t
             WHERE t.cash_box_id = b.id AND t.created_at < ${startsAt.toISOString()}::timestamptz
           ), 0) AS opening
    FROM cash_box b
    LEFT JOIN zone z ON z.id = b.zone_id
    ORDER BY b.name
  `)) as unknown as Row[];
  return rows.map((r) => ({
    cashBoxId: String(r.id),
    name: String(r.name),
    type: r.type as CashBoxType,
    zoneId: str(r.zone_id),
    zonePath: str(r.zone_path),
    collectorId: str(r.assigned_to),
    openingMinor: num(r.opening),
  }));
}

async function readFlows(
  tx: Tx,
  range: SettlementRange,
): Promise<SettlementFlow[]> {
  const rows = (await tx.execute(sql`
    SELECT cash_box_id, zone_id, collector_id, kind, direction, debt_closure_type,
           SUM(amount_minor) AS amount
    FROM cash_transaction
    WHERE created_at >= ${range.startsAt.toISOString()}::timestamptz
      AND created_at < ${range.endsAt.toISOString()}::timestamptz
    GROUP BY cash_box_id, zone_id, collector_id, kind, direction, debt_closure_type
  `)) as unknown as Row[];
  return rows.map((r) => ({
    cashBoxId: String(r.cash_box_id),
    zoneId: str(r.zone_id),
    collectorId: str(r.collector_id),
    kind: r.kind as CashTxKind,
    direction: r.direction as CashTxDirection,
    debtClosureType: (r.debt_closure_type as DebtClosureType | null) ?? null,
    amountMinor: num(r.amount),
  }));
}

async function readZones(tx: Tx): Promise<SettlementZoneRef[]> {
  const rows = (await tx.execute(
    sql`SELECT id, name, path::text AS path FROM zone`,
  )) as unknown as Row[];
  return rows.map((r) => ({
    zoneId: String(r.id),
    name: String(r.name),
    path: String(r.path),
  }));
}

/** Cobradores con caja de ruta (la zona de la caja es la del cobrador para el recorte). */
async function readCollectors(tx: Tx): Promise<SettlementCollectorRef[]> {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (b.assigned_to) b.assigned_to AS collector_id, u.email, z.path::text AS zone_path
    FROM cash_box b
    LEFT JOIN app_user u ON u.id = b.assigned_to
    LEFT JOIN zone z ON z.id = b.zone_id
    WHERE b.assigned_to IS NOT NULL
    ORDER BY b.assigned_to, b.created_at
  `)) as unknown as Row[];
  return rows.map((r) => ({
    collectorId: String(r.collector_id),
    email: str(r.email),
    zonePath: str(r.zone_path),
  }));
}

/**
 * Cartera por zona del crédito: desglose capital/interés de lo abonado en el rango, créditos
 * nuevos, lo que vencía en el período y la mora al corte (estado de la cartera al calcular).
 */
async function readPortfolio(
  tx: Tx,
  range: SettlementRange,
): Promise<PortfolioByZone[]> {
  const starts = range.startsAt.toISOString();
  const ends = range.endsAt.toISOString();
  const rows = (await tx.execute(sql`
    WITH paid AS (
      SELECT c.zone_id,
             SUM(COALESCE(pa.interest_minor, 0)) AS interest,
             SUM(COALESCE(pa.principal_minor, 0)) AS principal,
             SUM(pa.amount_minor) AS collected
      FROM payment_allocation pa
      JOIN installment i ON i.id = pa.installment_id
      JOIN credit c ON c.id = i.credit_id
      WHERE pa.created_at >= ${starts}::timestamptz AND pa.created_at < ${ends}::timestamptz
      GROUP BY c.zone_id
    ), granted AS (
      SELECT zone_id, count(*) AS credits, SUM(principal_minor) AS principal
      FROM credit
      WHERE created_at >= ${starts}::timestamptz AND created_at < ${ends}::timestamptz
      GROUP BY zone_id
    ), due AS (
      SELECT c.zone_id,
             SUM(CASE WHEN i.due_date >= ${range.periodStart}::date AND i.due_date < ${range.periodEnd}::date
                      THEN i.amount_due_minor ELSE 0 END) AS due_in_period,
             SUM(CASE WHEN i.due_date < ${range.periodEnd}::date AND i.paid_minor < i.amount_due_minor
                       AND c.status = 'ACTIVE'
                      THEN i.amount_due_minor - i.paid_minor ELSE 0 END) AS overdue
      FROM installment i
      JOIN credit c ON c.id = i.credit_id
      GROUP BY c.zone_id
    )
    SELECT z.zone_id,
           COALESCE(paid.interest, 0) AS interest, COALESCE(paid.principal, 0) AS principal,
           COALESCE(paid.collected, 0) AS collected,
           COALESCE(granted.credits, 0) AS credits, COALESCE(granted.principal, 0) AS granted_principal,
           COALESCE(due.due_in_period, 0) AS due_in_period, COALESCE(due.overdue, 0) AS overdue
    FROM (SELECT zone_id FROM paid UNION SELECT zone_id FROM granted UNION SELECT zone_id FROM due) z
    LEFT JOIN paid ON paid.zone_id = z.zone_id
    LEFT JOIN granted ON granted.zone_id = z.zone_id
    LEFT JOIN due ON due.zone_id = z.zone_id
  `)) as unknown as Row[];
  return rows.map((r) => ({
    zoneId: String(r.zone_id),
    interestEarnedMinor: num(r.interest),
    principalRecoveredMinor: num(r.principal),
    newCreditsCount: num(r.credits),
    newCreditsPrincipalMinor: num(r.granted_principal),
    dueInPeriodMinor: num(r.due_in_period),
    collectedOnPortfolioMinor: num(r.collected),
    overdueAtCutMinor: num(r.overdue),
  }));
}

/**
 * Actividad de campo por cobrador en el rango: paradas (despachadas, liquidadas, con pago y
 * minutos de respuesta), consignaciones (ordenadas, verificadas, minutos hasta reportar) y
 * rendiciones (declaradas y cuántas tarde). Una consulta por fuente, agregada por cobrador.
 */
async function readCollectorActivity(
  tx: Tx,
  range: SettlementRange,
): Promise<CollectorActivity[]> {
  const starts = range.startsAt.toISOString();
  const ends = range.endsAt.toISOString();
  // Fragmentos parametrizados (sin sql.raw): la columna es un literal fijo del código.
  const within = (col: SQL) =>
    sql`${col} >= ${starts}::timestamptz AND ${col} < ${ends}::timestamptz`;
  const rows = (await tx.execute(sql`
    WITH stops AS (
      SELECT collector_id,
             count(*) FILTER (WHERE ${within(sql`dispatched_at`)}) AS dispatched,
             count(*) FILTER (WHERE status = 'RESOLVED' AND ${within(sql`resolved_at`)}) AS resolved,
             count(*) FILTER (WHERE outcome = 'PAID' AND ${within(sql`resolved_at`)}) AS paid,
             COALESCE(SUM(EXTRACT(EPOCH FROM (resolved_at - dispatched_at)) / 60)
               FILTER (WHERE status = 'RESOLVED' AND ${within(sql`resolved_at`)}), 0) AS resolve_minutes
      FROM route_stop GROUP BY collector_id
    ), deposits AS (
      SELECT collector_id,
             count(*) FILTER (WHERE ${within(sql`issued_at`)}) AS issued,
             count(*) FILTER (WHERE status = 'VERIFIED' AND ${within(sql`verified_at`)}) AS verified,
             count(*) FILTER (WHERE ${within(sql`reported_at`)}) AS reported,
             COALESCE(SUM(EXTRACT(EPOCH FROM (reported_at - issued_at)) / 60)
               FILTER (WHERE ${within(sql`reported_at`)}), 0) AS report_minutes
      FROM field_order GROUP BY collector_id
    ), remittances AS (
      SELECT collector_id,
             count(*) FILTER (WHERE ${within(sql`submitted_at`)}) AS submitted,
             count(*) FILTER (WHERE ${within(sql`submitted_at`)} AND due_at IS NOT NULL AND submitted_at > due_at) AS late
      FROM collector_remittance GROUP BY collector_id
    )
    SELECT c.collector_id,
           COALESCE(stops.dispatched, 0) AS dispatched, COALESCE(stops.resolved, 0) AS resolved,
           COALESCE(stops.paid, 0) AS paid, COALESCE(stops.resolve_minutes, 0) AS resolve_minutes,
           COALESCE(deposits.issued, 0) AS issued, COALESCE(deposits.verified, 0) AS verified,
           COALESCE(deposits.reported, 0) AS reported, COALESCE(deposits.report_minutes, 0) AS report_minutes,
           COALESCE(remittances.submitted, 0) AS submitted, COALESCE(remittances.late, 0) AS late
    FROM (SELECT collector_id FROM stops UNION SELECT collector_id FROM deposits
          UNION SELECT collector_id FROM remittances) c
    LEFT JOIN stops ON stops.collector_id = c.collector_id
    LEFT JOIN deposits ON deposits.collector_id = c.collector_id
    LEFT JOIN remittances ON remittances.collector_id = c.collector_id
  `)) as unknown as Row[];
  return rows.map((r) => ({
    collectorId: String(r.collector_id),
    stopsDispatched: num(r.dispatched),
    stopsResolved: num(r.resolved),
    stopsPaid: num(r.paid),
    resolveMinutesTotal: num(r.resolve_minutes),
    depositsIssued: num(r.issued),
    depositsVerified: num(r.verified),
    depositReportMinutesTotal: num(r.report_minutes),
    depositsReported: num(r.reported),
    remittancesSubmitted: num(r.submitted),
    remittancesLate: num(r.late),
  }));
}
