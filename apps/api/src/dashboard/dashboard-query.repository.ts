import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  eq,
  gte,
  lt,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CashTxKind } from '@preztiaos/domain';
import type {
  ApplicationTimingWindow,
  DashboardApplicationTimings,
  DashboardKpisOutput,
  DashboardPending,
  DashboardToday,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import {
  businessDayBounds,
  type BusinessDayBounds,
} from '../tenant-config/tenant-timezone';
import { loadTreasuryByClass } from '../cash/treasury-snapshot';
import type { TreasuryByClass } from '../cash/treasury-by-class';

// Umbral del veredicto antifraude a partir del cual un documento se considera intento de
// fraude (SCORE_SUSPICIOUS en StructuralAntifraudService). Constante con nombre, sin número mágico.
const FRAUD_SCORE_THRESHOLD = 60;

// Tipos de evento de la bitácora append-only que sellan los hitos de una solicitud.
// El instante en que un documento deja la solicitud IN_REVIEW marca el inicio del estudio;
// la decisión manual (aprobar/negar) marca el fin (aprobar = desembolsar, misma transacción).
const DOCUMENT_RECORDED_EVENT = 'DOCUMENT_RECORDED';
const DECISION_EVENT = 'MANUAL_REVIEW_DECISION';

// Saldo pendiente de una cuota: lo que falta por pagar de ella.
const installmentOutstanding = sql`${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}`;

// Asientos del libro de cajas que el dueño lee como "prestado hoy" y "gastos de hoy".
const DISBURSEMENT_KIND: CashTxKind = 'DISBURSEMENT';
const EXPENSE_KIND: CashTxKind = 'EXPENSE';

// Bloque "Pendientes": estados que esperan una acción humana. Cada constante refleja el criterio
// del read model dueño de ese flujo (bandeja de solicitudes, gastos, tablero de rendiciones,
// consignaciones y pagos), para que el contador del panel coincida con lo que esa pantalla lista.
const APPLICATION_AWAITING_DECISION = 'IN_REVIEW';
const EXPENSE_AWAITING_APPROVAL = 'PENDING';
const REMITTANCE_AWAITING_RECEPTION = 'SUBMITTED';
const DEPOSIT_ORDER_KIND = 'DEPOSIT';
const DEPOSIT_AWAITING_VERIFICATION = 'REPORTED';
// Un pago espera confirmación cuando sigue UNVERIFIED y su evaluación de conciliación (fase 2)
// quedó PENDING_REVIEW: crédito real reservado a la espera de aprobación (payments-query).
const PAYMENT_UNVERIFIED = 'UNVERIFIED';
const SETTLEMENT_ASSESSMENT_PHASE = 'PHASE2_SETTLEMENT';
const ASSESSMENT_PENDING_REVIEW = 'PENDING_REVIEW';

/**
 * Read model del DASHBOARD INICIAL (CQRS): consolida en una sola consulta agrupada los KPIs
 * financieros, de conversión de solicitudes y de riesgo/fraude del tenant. Solo lectura; RLS
 * aísla por tenant. Toda métrica se calcula por agregación en BD (count/sum), sin N+1.
 */
@Injectable()
export class DashboardQueryRepository {
  async getKpis(input: {
    tenantId: string;
    currency: string;
  }): Promise<DashboardKpisOutput> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      // "Hoy" es el día de negocio de la EMPRESA (ADR #46), no el de UTC: en Colombia el panel
      // no se vacía a las 19:00.
      const day = await businessDayBounds(tx, input.tenantId);
      const today = day.date;

      // --- Tesorería: saldo de las cajas activas, repartido por clase -------
      const treasury = await loadTreasuryByClass(tx);

      // --- Cartera activa: deuda vigente de créditos ACTIVE ------------------
      const [portfolioActive] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}), 0)`,
        })
        .from(schema.installment)
        .innerJoin(
          schema.credit,
          eq(schema.credit.id, schema.installment.creditId),
        )
        .where(eq(schema.credit.status, 'ACTIVE'));

      // --- Cartera vencida: deuda de cuotas en mora (vencidas y no saldadas) --
      const [portfolioOverdue] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}), 0)`,
        })
        .from(schema.installment)
        .where(
          and(
            sql`${schema.installment.paidMinor} < ${schema.installment.amountDueMinor}`,
            sql`${schema.installment.dueDate} < ${today}`,
          ),
        );

      // --- Solicitudes de crédito por estado (una pasada con FILTER) ---------
      const [applications] = await tx
        .select({
          approved: sql<number>`COUNT(*) FILTER (WHERE ${schema.creditApplication.status} = 'APPROVED')`,
          inProgress: sql<number>`COUNT(*) FILTER (WHERE ${schema.creditApplication.status} IN ('AWAITING_DOCUMENTS', 'IN_REVIEW'))`,
          rejected: sql<number>`COUNT(*) FILTER (WHERE ${schema.creditApplication.status} = 'REJECTED')`,
        })
        .from(schema.creditApplication);

      // --- Riesgo y fraude ---------------------------------------------------
      // Cada extracción registrada es un intento de subir un documento al sistema.
      const [uploads] = await tx
        .select({ v: count() })
        .from(schema.documentExtraction);

      // Intentos de fraude: documentos con score de riesgo por encima del umbral.
      const [fraud] = await tx
        .select({ v: count() })
        .from(schema.creditApplicationDocument)
        .where(
          sql`${schema.creditApplicationDocument.fraudScore} >= ${FRAUD_SCORE_THRESHOLD}`,
        );

      // --- Trazabilidad de tiempos de atención por ventana de calendario -----
      const applicationTimings = await this.getApplicationTimings(tx);

      return {
        currency: input.currency,
        today: await this.getToday(tx, day, treasury),
        pending: await this.getPending(tx),
        treasury: {
          ...treasury,
          portfolioActiveMinor: Number(portfolioActive?.v ?? 0),
          portfolioOverdueMinor: Number(portfolioOverdue?.v ?? 0),
        },
        applications: {
          approved: Number(applications?.approved ?? 0),
          inProgress: Number(applications?.inProgress ?? 0),
          rejected: Number(applications?.rejected ?? 0),
        },
        applicationTimings,
        risk: {
          documentUploadAttempts: Number(uploads?.v ?? 0),
          fraudAttemptsDetected: Number(fraud?.v ?? 0),
        },
      };
    });
  }

  /**
   * Bloque "HOY": cómo va el negocio en el día de negocio `day`. Cobrado = abonos aplicados en la
   * ventana `[start, end)` sin los históricos de créditos migrados (mismo criterio que el reporte
   * diario); esperado/vencido = pendiente de las cuotas de créditos ACTIVE que vencen hoy / antes;
   * prestado y gastos = asientos del libro de cajas del día. Tres consultas agregadas, sin N+1.
   */
  private async getToday(
    tx: Tx,
    day: BusinessDayBounds,
    treasury: TreasuryByClass,
  ): Promise<DashboardToday> {
    const withinDay = (col: AnyColumn): SQL =>
      and(gte(col, day.start), lt(col, day.end)) as SQL;

    const [collected] = await tx
      .select({
        v: sql<number>`COALESCE(SUM(${schema.paymentAllocation.amountMinor}), 0)`,
      })
      .from(schema.paymentAllocation)
      .innerJoin(
        schema.payment,
        eq(schema.payment.id, schema.paymentAllocation.paymentId),
      )
      .where(
        and(
          withinDay(schema.paymentAllocation.createdAt),
          eq(schema.payment.historical, false),
        ),
      );

    const [due] = await tx
      .select({
        expectedToday: sql<number>`COALESCE(SUM(${installmentOutstanding}) FILTER (WHERE ${schema.installment.dueDate} = ${day.date}), 0)`,
        overdue: sql<number>`COALESCE(SUM(${installmentOutstanding}) FILTER (WHERE ${schema.installment.dueDate} < ${day.date}), 0)`,
      })
      .from(schema.installment)
      .innerJoin(
        schema.credit,
        eq(schema.credit.id, schema.installment.creditId),
      )
      .where(eq(schema.credit.status, 'ACTIVE'));

    const [moves] = await tx
      .select({
        lent: sql<number>`COALESCE(SUM(${schema.cashTransaction.amountMinor}) FILTER (WHERE ${schema.cashTransaction.kind} = ${DISBURSEMENT_KIND}), 0)`,
        expenses: sql<number>`COALESCE(SUM(${schema.cashTransaction.amountMinor}) FILTER (WHERE ${schema.cashTransaction.kind} = ${EXPENSE_KIND}), 0)`,
      })
      .from(schema.cashTransaction)
      .where(withinDay(schema.cashTransaction.createdAt));

    return {
      date: day.date,
      collectedMinor: Number(collected?.v ?? 0),
      expectedTodayMinor: Number(due?.expectedToday ?? 0),
      overdueDueMinor: Number(due?.overdue ?? 0),
      lentMinor: Number(moves?.lent ?? 0),
      expensesMinor: Number(moves?.expenses ?? 0),
      cashOfficeMinor: treasury.officeMinor,
      cashRouteMinor: treasury.routeMinor,
      bankMinor: treasury.bankMinor,
    };
  }

  /**
   * Bloque "PENDIENTES": contadores de lo que espera una acción humana, en una sola pasada
   * (cinco subconsultas escalares; RLS aísla cada tabla por tenant).
   */
  private async getPending(tx: Tx): Promise<DashboardPending> {
    const rows = (await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM ${schema.creditApplication}
           WHERE ${schema.creditApplication.status} = ${APPLICATION_AWAITING_DECISION}) AS applications,
        (SELECT count(*) FROM ${schema.expense}
           WHERE ${schema.expense.status} = ${EXPENSE_AWAITING_APPROVAL}) AS expenses,
        (SELECT count(*) FROM ${schema.collectorRemittance}
           WHERE ${schema.collectorRemittance.status} = ${REMITTANCE_AWAITING_RECEPTION}) AS remittances,
        (SELECT count(*) FROM ${schema.fieldOrder}
           WHERE ${schema.fieldOrder.kind} = ${DEPOSIT_ORDER_KIND}
             AND ${schema.fieldOrder.status} = ${DEPOSIT_AWAITING_VERIFICATION}) AS deposits,
        (SELECT count(*) FROM ${schema.payment}
           WHERE ${schema.payment.status} = ${PAYMENT_UNVERIFIED}
             AND EXISTS (
               SELECT 1 FROM ${schema.fraudAssessment}
               WHERE ${schema.fraudAssessment.paymentId} = ${schema.payment.id}
                 AND ${schema.fraudAssessment.phase} = ${SETTLEMENT_ASSESSMENT_PHASE}
                 AND ${schema.fraudAssessment.status} = ${ASSESSMENT_PENDING_REVIEW}
             )) AS payments
    `)) as unknown as PendingRow[];
    const row = rows[0];
    return {
      applicationsToApprove: Number(row?.applications ?? 0),
      expensesToApprove: Number(row?.expenses ?? 0),
      remittancesToReceive: Number(row?.remittances ?? 0),
      depositsToVerify: Number(row?.deposits ?? 0),
      paymentsToConfirm: Number(row?.payments ?? 0),
    };
  }

  /**
   * Tiempos de atención por ventana de calendario acumulada (hoy / semana / mes / año).
   * Reconstruye los hitos de cada solicitud RESUELTA desde la bitácora append-only y promedia,
   * en una sola pasada, la duración de cada tramo. Un CTE deriva por solicitud sus tres sellos
   * (t0 entró, t1 en estudio, t2 decisión/desembolso); la agregación usa FILTER por la fecha de
   * decisión (t2), de modo que cada ventana incluye solo lo resuelto dentro de su periodo. Sin
   * N+1: los subselects de hitos usan el índice por application_id de la bitácora.
   */
  private async getApplicationTimings(
    tx: Tx,
  ): Promise<DashboardApplicationTimings> {
    const rows = (await tx.execute(sql`
      WITH milestones AS (
        SELECT
          ca.id         AS id,
          ca.created_at AS t0,
          (SELECT MIN(e.created_at) FROM credit_application_event e
             WHERE e.application_id = ca.id
               AND e.type = ${DOCUMENT_RECORDED_EVENT}
               AND e.payload->>'applicationStatus' = 'IN_REVIEW') AS t1,
          (SELECT MIN(e.created_at) FROM credit_application_event e
             WHERE e.application_id = ca.id
               AND e.type = ${DECISION_EVENT}) AS t2
        FROM credit_application ca
        WHERE ca.status IN ('APPROVED', 'REJECTED')
      ),
      decided AS (
        SELECT
          t1, t2,
          EXTRACT(EPOCH FROM (t1 - t0)) / 60.0 AS intake_min,
          EXTRACT(EPOCH FROM (t2 - t1)) / 60.0 AS review_min,
          EXTRACT(EPOCH FROM (t2 - t0)) / 60.0 AS total_min
        FROM milestones
        WHERE t2 IS NOT NULL
      )
      SELECT
        ${windowColumns('today', sql`date_trunc('day', now())`)},
        ${windowColumns('week', sql`date_trunc('week', now())`)},
        ${windowColumns('month', sql`date_trunc('month', now())`)},
        ${windowColumns('year', sql`date_trunc('year', now())`)}
      FROM decided
    `)) as unknown as TimingRow[];

    const row = rows[0];
    return {
      today: mapWindow(row, 'today'),
      week: mapWindow(row, 'week'),
      month: mapWindow(row, 'month'),
      year: mapWindow(row, 'year'),
    };
  }
}

// Columnas agregadas de una ventana: conteo de resueltas y promedios (enteros) de cada tramo.
// `since` es el inicio del periodo (date_trunc); solo se promedia lo decidido a partir de él.
// Los tramos intake/review requieren t1 (que la solicitud haya llegado a estudio).
function windowColumns(name: string, since: ReturnType<typeof sql>) {
  const inWindow = sql`t2 >= ${since}`;
  const withStudy = sql`t2 >= ${since} AND t1 IS NOT NULL`;
  return sql`
    COUNT(*) FILTER (WHERE ${inWindow}) AS ${sql.raw(`${name}_count`)},
    ROUND(AVG(intake_min) FILTER (WHERE ${withStudy})) AS ${sql.raw(`${name}_intake`)},
    ROUND(AVG(review_min) FILTER (WHERE ${withStudy})) AS ${sql.raw(`${name}_review`)},
    ROUND(AVG(total_min)  FILTER (WHERE ${inWindow}))  AS ${sql.raw(`${name}_total`)}
  `;
}

// Fila cruda: cada ventana aporta cuatro columnas (conteo + tres promedios), posibles null.
type TimingRow = Record<string, number | string | null>;

// Fila cruda de los contadores pendientes: count(*) llega como bigint (string) desde Postgres.
type PendingRow = Record<
  'applications' | 'expenses' | 'remittances' | 'deposits' | 'payments',
  number | string | null
>;

// Traduce las columnas de una ventana a su DTO. AVG/ROUND devuelven null cuando no hay filas
// que cumplan el filtro (periodo sin datos), lo que preserva la semántica `nullable` del tramo.
function mapWindow(
  row: TimingRow | undefined,
  name: string,
): ApplicationTimingWindow {
  return {
    decidedCount: Number(row?.[`${name}_count`] ?? 0),
    avgIntakeMinutes: toIntOrNull(row?.[`${name}_intake`]),
    avgReviewMinutes: toIntOrNull(row?.[`${name}_review`]),
    avgTotalMinutes: toIntOrNull(row?.[`${name}_total`]),
  };
}

function toIntOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value));
}
