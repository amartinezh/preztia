import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato del DASHBOARD INICIAL de KPIs: panel de bienvenida que consolida en una sola
// vista las métricas financieras, de conversión de solicitudes y de riesgo/fraude del tenant.
// Solo lectura (read-model / CQRS); deriva de cartera, caja, solicitudes y antifraude.
// Dinero siempre en unidades menores (entero).

// Bloque financiero (tesorería + cartera).
export const dashboardTreasury = z.object({
  /** Σ saldo de todas las cajas activas del tenant (efectivo disponible). */
  cashAvailableMinor: z.number().int(),
  /** Deuda vigente de la cartera activa (Σ cuota pendiente de créditos ACTIVE). */
  portfolioActiveMinor: z.number().int(),
  /** Cartera vencida: Σ cuota pendiente de cuotas en mora (vencidas y no saldadas). */
  portfolioOverdueMinor: z.number().int(),
});

// Bloque de conversión de solicitudes de crédito (KYC).
export const dashboardApplications = z.object({
  /** Solicitudes aprobadas (status APPROVED). */
  approved: z.number().int(),
  /** Solicitudes en curso / sin procesar (AWAITING_DOCUMENTS + IN_REVIEW). */
  inProgress: z.number().int(),
  /** Solicitudes negadas (status REJECTED). */
  rejected: z.number().int(),
});

// Bloque de seguridad y control operativo (riesgo + fraude).
export const dashboardRisk = z.object({
  /** Total de intentos de subir documentos al sistema (extracciones registradas). */
  documentUploadAttempts: z.number().int(),
  /** Intentos de fraude detectados (documentos con score de riesgo por encima del umbral). */
  fraudAttemptsDetected: z.number().int(),
});

// Trazabilidad de TIEMPOS DE ATENCIÓN de las solicitudes (para detectar demoras humanas).
// Cada solicitud resuelta atraviesa hitos sellados en la bitácora append-only:
// Entró (created) → En estudio (docs completos → IN_REVIEW) → Decisión/Desembolso (aprobar/negar).
// Aprobar y desembolsar ocurren en la MISMA transacción, así que ese instante es el desembolso.
// Promedios en minutos (enteros); null cuando el periodo no tiene datos para ese tramo.
export const applicationTimingWindow = z.object({
  /** Solicitudes resueltas (aprobadas o negadas) cuya decisión cae dentro del periodo. */
  decidedCount: z.number().int(),
  /** Promedio Entró → En estudio: tiempo de documentación del cliente. */
  avgIntakeMinutes: z.number().int().nullable(),
  /** Promedio En estudio → Decisión/desembolso: la demora humana del coordinador. */
  avgReviewMinutes: z.number().int().nullable(),
  /** Promedio extremo a extremo Entró → Decisión/desembolso. */
  avgTotalMinutes: z.number().int().nullable(),
});
export type ApplicationTimingWindow = z.infer<typeof applicationTimingWindow>;

// Los mismos tiempos agregados en ventanas de calendario acumuladas: hoy, esta semana,
// este mes, este año. Se resuelven en una sola consulta para que el selector no haga refetch.
export const dashboardApplicationTimings = z.object({
  today: applicationTimingWindow,
  week: applicationTimingWindow,
  month: applicationTimingWindow,
  year: applicationTimingWindow,
});
export type DashboardApplicationTimings = z.infer<typeof dashboardApplicationTimings>;

export const dashboardKpisOutput = z.object({
  currency: z.string(),
  treasury: dashboardTreasury,
  applications: dashboardApplications,
  applicationTimings: dashboardApplicationTimings,
  risk: dashboardRisk,
});
export type DashboardKpisOutput = z.infer<typeof dashboardKpisOutput>;
export type DashboardTreasury = z.infer<typeof dashboardTreasury>;
export type DashboardApplications = z.infer<typeof dashboardApplications>;
export type DashboardRisk = z.infer<typeof dashboardRisk>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const dashboardContract = c.router({
  getDashboardKpis: {
    method: "GET",
    path: "/dashboard/kpis",
    headers: tenantHeaders,
    responses: { 200: dashboardKpisOutput },
    summary: "Dashboard inicial: KPIs financieros, de solicitudes y de riesgo/fraude",
  },
});
