import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { treasuryByClass } from "./cash-boxes";

const c = initContract();

// Contrato del DASHBOARD INICIAL de KPIs: panel de bienvenida que consolida en una sola
// vista las métricas financieras, de conversión de solicitudes y de riesgo/fraude del tenant.
// Solo lectura (read-model / CQRS); deriva de cartera, caja, solicitudes y antifraude.
// Dinero siempre en unidades menores (entero).

// Bloque financiero (tesorería + cartera).
// Tesorería = el reparto canónico por clase (misma regla que Dinero y Operación) + la cartera.
export const dashboardTreasury = treasuryByClass.extend({
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

// Bloque "HOY": cómo va el negocio en el día de negocio de la EMPRESA (zona horaria del tenant).
export const dashboardToday = z.object({
  /** Día de negocio (YYYY-MM-DD) en la zona horaria de la empresa al que se refieren las cifras. */
  date: z.string(),
  /** Cobrado hoy: Σ abonos aplicados a cuotas hoy (sin los históricos de créditos migrados). */
  collectedMinor: z.number().int(),
  /** Esperado hoy: Σ pendiente de las cuotas que vencen hoy en créditos activos. */
  expectedTodayMinor: z.number().int(),
  /** Vencido pendiente: Σ pendiente de cuotas vencidas antes de hoy (lo que se arrastra). */
  overdueDueMinor: z.number().int(),
  /** Prestado hoy: Σ desembolsos del día. */
  lentMinor: z.number().int(),
  /** Gastos pagados hoy. */
  expensesMinor: z.number().int(),
  /** Efectivo en cajas de oficina (CASH sin cobrador). */
  cashOfficeMinor: z.number().int(),
  /** Efectivo en la calle: Σ cajas de ruta de los cobradores. */
  cashRouteMinor: z.number().int(),
  /** Dinero en cuentas bancarias. */
  bankMinor: z.number().int(),
});
export type DashboardToday = z.infer<typeof dashboardToday>;

// Bloque "PENDIENTES": lo que espera una acción humana, con contador para ir directo.
export const dashboardPending = z.object({
  /** Solicitudes con expediente completo esperando decisión (IN_REVIEW). */
  applicationsToApprove: z.number().int(),
  /** Solicitudes de gasto pendientes de aprobación. */
  expensesToApprove: z.number().int(),
  /** Rendiciones declaradas por cobradores, pendientes de recibir y contar. */
  remittancesToReceive: z.number().int(),
  /** Consignaciones reportadas por cobradores, pendientes de verificar. */
  depositsToVerify: z.number().int(),
  /** Pagos PIX conciliados con un crédito real que esperan aprobación manual. */
  paymentsToConfirm: z.number().int(),
});
export type DashboardPending = z.infer<typeof dashboardPending>;

export const dashboardKpisOutput = z.object({
  currency: z.string(),
  today: dashboardToday,
  pending: dashboardPending,
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
