import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ApplicationTimingWindow,
  DashboardApplicationTimings,
  DashboardKpisOutput,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';

// Umbral del veredicto antifraude a partir del cual un documento se considera intento de
// fraude (SCORE_SUSPICIOUS en StructuralAntifraudService). Constante con nombre, sin número mágico.
const FRAUD_SCORE_THRESHOLD = 60;

// Tipos de evento de la bitácora append-only que sellan los hitos de una solicitud.
// El instante en que un documento deja la solicitud IN_REVIEW marca el inicio del estudio;
// la decisión manual (aprobar/negar) marca el fin (aprobar = desembolsar, misma transacción).
const DOCUMENT_RECORDED_EVENT = 'DOCUMENT_RECORDED';
const DECISION_EVENT = 'MANUAL_REVIEW_DECISION';

// Suma firmada del libro mayor de caja: IN suma, OUT resta. Espejo de cash-query.repository.
const signedCashSum = sql<number>`COALESCE(SUM(CASE WHEN ${schema.cashTransaction.direction} = 'IN' THEN ${schema.cashTransaction.amountMinor} ELSE -${schema.cashTransaction.amountMinor} END), 0)`;

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
    const today = todayIso();
    return withTenantTxFor(input.tenantId, async (tx) => {
      // --- Tesorería: efectivo en cajas activas ------------------------------
      const [cash] = await tx
        .select({ v: signedCashSum })
        .from(schema.cashBox)
        .leftJoin(
          schema.cashTransaction,
          eq(schema.cashTransaction.cashBoxId, schema.cashBox.id),
        )
        .where(eq(schema.cashBox.active, true));

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
        treasury: {
          cashAvailableMinor: Number(cash?.v ?? 0),
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
