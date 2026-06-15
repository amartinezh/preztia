import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de REPORTERÍA (read-models / CQRS): panel del tenant, resumen de cliente y export.
// Solo lectura; deriva de la cartera, pagos, caja y operación ya existentes.

export const dashboard = z.object({
  currency: z.string(),
  totalBorrowers: z.number().int(),
  activeCredits: z.number().int(),
  overdueAccounts: z.number().int(),
  /** Deuda vigente total de la cartera (Σ saldo de cuotas). */
  portfolioOutstandingMinor: z.number().int(),
  collectedTodayMinor: z.number().int(),
  lentTodayMinor: z.number().int(),
  /** Saldo de caja al cierre de la última liquidada. */
  cashCurrentMinor: z.number().int(),
  pendingExpenses: z.number().int(),
  pendingChangeRequests: z.number().int(),
});
export type Dashboard = z.infer<typeof dashboard>;

// Resumen de un cliente ("Resumen Cliente desde la última liquidada").
export const borrowerReport = z.object({
  borrowerId: z.string().uuid(),
  name: z.string().nullable(),
  nationalId: z.string(),
  activeCredits: z.number().int(),
  settledCredits: z.number().int(),
  outstandingMinor: z.number().int(),
  /** Lo que debió pagar desde la última liquidada (cuotas vencidas en la ventana). */
  dueSinceLastSettlementMinor: z.number().int(),
  /** Lo que efectivamente pagó (abonos) desde la última liquidada. */
  paidSinceLastSettlementMinor: z.number().int(),
});
export type BorrowerReport = z.infer<typeof borrowerReport>;

// Export del listado de cuentas: el servidor arma el CSV (sin dependencias); el cliente lo
// descarga/guarda según la plataforma.
export const accountsExport = z.object({
  filename: z.string(),
  csv: z.string(),
});

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const reportingContract = c.router({
  getDashboard: {
    method: "GET",
    path: "/reports/dashboard",
    headers: tenantHeaders,
    responses: { 200: dashboard },
    summary: "Panel del tenant: cartera, cobro del día, caja y pendientes",
  },
  getBorrowerReport: {
    method: "GET",
    path: "/borrowers/:id/summary",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    responses: { 200: borrowerReport },
    summary: "Resumen del cliente desde la última liquidada",
  },
  exportAccounts: {
    method: "GET",
    path: "/reports/accounts-export",
    headers: tenantHeaders,
    responses: { 200: accountsExport },
    summary: "Genera el CSV del listado de cuentas (Generar Tarjetas)",
  },
});
