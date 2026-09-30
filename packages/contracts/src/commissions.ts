import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { commissionBase } from "./settlements";

const c = initContract();

// Contrato de la CONFIGURACIÓN DE COMISIONES del cobrador. El ADMIN fija en los ajustes del tenant
// el valor por defecto y el TOPE; cada zona puede tener su propia política (porcentaje + base) que
// heredan sus zonas hijas. El COORDINATOR configura las zonas de su subárbol sin superar el tope.
// Porcentajes en base mil (50 = 5 %), como el interés.

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const zoneParam = z.object({ zoneId: z.string().uuid() });

export const commissionPolicy = z.object({
  ratePerMille: z.number().int().min(0).max(1000),
  base: commissionBase,
});
export type CommissionPolicy = z.infer<typeof commissionPolicy>;

export const effectiveCommissionPolicy = commissionPolicy.extend({
  /** Zona de la que se hereda; null = valor por defecto del tenant. */
  sourceZoneId: z.string().uuid().nullable(),
  /** Nombre de esa zona (puede estar fuera del alcance de quien mira: un ancestro). */
  sourceZoneName: z.string().nullable(),
  /** La tasa configurada supera el tope actual y se recorta al calcular. */
  cappedByLimit: z.boolean(),
});

export const zoneCommissionView = z.object({
  zoneId: z.string().uuid(),
  parentZoneId: z.string().uuid().nullable(),
  name: z.string(),
  path: z.string(),
  /** Configuración propia; null = hereda. */
  own: commissionPolicy.nullable(),
  effective: effectiveCommissionPolicy,
});
export type ZoneCommissionView = z.infer<typeof zoneCommissionView>;

export const commissionSettingsView = z.object({
  /** ¿El tenant paga comisiones? Apagadas, la configuración se guarda pero no se causa nada. */
  enabled: z.boolean(),
  tenantDefault: commissionPolicy,
  /** Tope del ADMIN (base mil); 0 = nadie cobra comisión. */
  capPerMille: z.number().int(),
  /** Zonas al alcance de quien consulta (el ADMIN, todas), en orden de árbol. */
  zones: z.array(zoneCommissionView),
});
export type CommissionSettingsView = z.infer<typeof commissionSettingsView>;

export const commissionsContract = c.router({
  getCommissionSettings: {
    method: "GET",
    path: "/commissions/settings",
    headers: tenantHeaders,
    responses: { 200: commissionSettingsView },
    summary: "Configuración de comisiones: defecto, tope y política propia/efectiva por zona",
  },
  setZoneCommission: {
    method: "PUT",
    path: "/commissions/zones/:zoneId",
    pathParams: zoneParam,
    headers: tenantHeaders,
    body: commissionPolicy,
    responses: { 200: commissionSettingsView },
    summary: "Fija la comisión propia de una zona (sin superar el tope) — ADMIN/COORDINATOR",
  },
  clearZoneCommission: {
    method: "DELETE",
    path: "/commissions/zones/:zoneId",
    pathParams: zoneParam,
    headers: tenantHeaders,
    body: z.object({}).optional(),
    responses: { 200: commissionSettingsView },
    summary: "Quita la comisión propia de una zona para que herede — ADMIN/COORDINATOR",
  },
});
