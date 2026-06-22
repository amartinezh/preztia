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

export const dashboardKpisOutput = z.object({
  currency: z.string(),
  treasury: dashboardTreasury,
  applications: dashboardApplications,
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
