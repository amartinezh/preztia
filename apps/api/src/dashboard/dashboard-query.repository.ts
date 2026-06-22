import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { DashboardKpisOutput } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Umbral del veredicto antifraude a partir del cual un documento se considera intento de
// fraude (SCORE_SUSPICIOUS en StructuralAntifraudService). Constante con nombre, sin número mágico.
const FRAUD_SCORE_THRESHOLD = 60;

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
        risk: {
          documentUploadAttempts: Number(uploads?.v ?? 0),
          fraudAttemptsDetected: Number(fraud?.v ?? 0),
        },
      };
    });
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
