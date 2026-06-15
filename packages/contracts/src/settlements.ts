import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de LIQUIDADAS (cierre de caja, "Nueva Liquidada" + "Lista Liquidadas"). El cierre
// encadena el saldo de caja; el preview calcula los totales pendientes desde la última liquidada.

export const settlement = z.object({
  id: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  cajaAnteriorMinor: z.number().int(),
  totalCobradoMinor: z.number().int(),
  totalPrestadoMinor: z.number().int(),
  gastosMinor: z.number().int(),
  cajaActualMinor: z.number().int(),
  cuentasNuevas: z.number().int(),
  cuentasTerminadas: z.number().int(),
  createdAt: z.string(),
});
export type Settlement = z.infer<typeof settlement>;

// Vista previa de "Nueva Liquidada": totales acumulados desde la última liquidada hasta ahora.
// `cajaActualMinor` es la proyección del saldo si se cierra en este momento.
export const settlementPreview = z.object({
  cajaAnteriorMinor: z.number().int(),
  totalCobradoMinor: z.number().int(),
  totalPrestadoMinor: z.number().int(),
  gastosMinor: z.number().int(),
  cajaActualMinor: z.number().int(),
  cuentasNuevas: z.number().int(),
  cuentasTerminadas: z.number().int(),
  periodStart: z.string(),
  currency: z.string(),
});
export type SettlementPreview = z.infer<typeof settlementPreview>;

export const listSettlementsOutput = z.object({
  items: z.array(settlement),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const settlementsContract = c.router({
  previewSettlement: {
    method: "GET",
    path: "/settlements/preview",
    headers: tenantHeaders,
    responses: { 200: settlementPreview },
    summary: "Totales pendientes de la próxima liquidada (caja, cobrado, prestado, gastos)",
  },
  closeSettlement: {
    method: "POST",
    path: "/settlements",
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 201: settlement },
    summary: "Cierra la liquidada del período y encadena la caja",
  },
  listSettlements: {
    method: "GET",
    path: "/settlements",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listSettlementsOutput },
    summary: "Historial de liquidadas (caja anterior → actual)",
  },
});
