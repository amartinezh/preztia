import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato del "Reporte diario": instantánea de la operación de un día (cobrado, prestado,
// gastos, caja del día y actividad). Read-model; no muta estado.

export const dailyReport = z.object({
  date: z.string(),
  currency: z.string(),
  totalCobradoMinor: z.number().int(),
  totalPrestadoMinor: z.number().int(),
  gastosMinor: z.number().int(),
  /** Caja del día = cobrado − prestado − gastos aprobados del día. */
  cajaDelDiaMinor: z.number().int(),
  /** Clientes distintos con al menos un abono en el día. */
  clientsWithPayments: z.number().int(),
  /** Créditos activos del tenant. */
  activeCredits: z.number().int(),
  /** Gastos pendientes de revisión (para el socio). */
  pendingExpenses: z.number().int(),
});
export type DailyReport = z.infer<typeof dailyReport>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const dailyReportContract = c.router({
  getDailyReport: {
    method: "GET",
    path: "/reports/daily",
    headers: tenantHeaders,
    query: z.object({ date: z.string().date().optional() }),
    responses: { 200: dailyReport },
    summary: "Reporte diario de cobro (cobrado, prestado, gastos, caja del día)",
  },
});
