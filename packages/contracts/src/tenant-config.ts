import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de CONFIGURACIÓN DE COBRO por tenant (toggles del legado). Solo el ADMIN la edita.
// Dinero en unidades menores; comisión en base-mil (200 = 20%), igual que el interés.

export const operationalSettings = z.object({
  rechargesEnabled: z.boolean(),
  manualRoute: z.boolean(),
  blockOverdueDatesForSales: z.boolean(),
  blockInterestChange: z.boolean(),
  commissionPctBaseThousand: z.number().int().min(0).max(1000),
  defaultCreditLimitMinor: z.number().int().min(0),
  applyColorByOverdue: z.boolean(),
});
export type OperationalSettings = z.infer<typeof operationalSettings>;

// Actualización parcial: solo se aplican los campos presentes.
export const updateOperationalSettingsInput = operationalSettings.partial();
export type UpdateOperationalSettingsInput = z.infer<typeof updateOperationalSettingsInput>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const tenantConfigContract = c.router({
  getOperationalSettings: {
    method: "GET",
    path: "/tenant-config/operational-settings",
    headers: tenantHeaders,
    responses: { 200: operationalSettings },
    summary: "Ajustes operativos del tenant (configuración de cobro)",
  },
  updateOperationalSettings: {
    method: "PATCH",
    path: "/tenant-config/operational-settings",
    headers: tenantHeaders,
    body: updateOperationalSettingsInput,
    responses: { 200: operationalSettings },
    summary: "Actualiza los ajustes operativos del tenant (ADMIN)",
  },
});
