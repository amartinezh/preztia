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
  // Negociación de planes por WhatsApp (Fase 10): autonomía del cliente, vencimiento de la oferta
  // (1 hora a 30 días) y override del administrador cuando el cliente no responde.
  clientChoosesPlan: z.boolean(),
  planOfferTtlHours: z.number().int().min(1).max(720),
  allowAdminOverride: z.boolean(),
});
export type OperationalSettings = z.infer<typeof operationalSettings>;

// Actualización parcial: solo se aplican los campos presentes.
export const updateOperationalSettingsInput = operationalSettings.partial();
export type UpdateOperationalSettingsInput = z.infer<typeof updateOperationalSettingsInput>;

// ── Configuración del asistente de WhatsApp por tenant (base de conocimiento + IA) ──────────
// Espeja el enum `ai_provider` de la BD. Hoy solo GEMINI está implementado en el servidor.
export const assistantAiProvider = z.enum(["GEMINI", "OPENAI", "CLAUDE"]);
export type AssistantAiProvider = z.infer<typeof assistantAiProvider>;

// Vista de lectura del asistente. SEGURIDAD: NUNCA expone la API key (secreto, §3.7); solo
// informa si hay una configurada (`hasApiKey`).
export const assistantConfigView = z.object({
  knowledgeBase: z.string(),
  aiProvider: assistantAiProvider,
  hasApiKey: z.boolean(),
});
export type AssistantConfigView = z.infer<typeof assistantConfigView>;

// Actualización parcial. `aiApiKey` solo viaja al ESCRIBIR; si se omite, no se toca; si llega
// vacío, se borra la credencial. Solo el ADMIN puede editarla.
export const updateAssistantConfigInput = z.object({
  knowledgeBase: z.string().max(20000).optional(),
  aiProvider: assistantAiProvider.optional(),
  aiApiKey: z.string().max(400).optional(),
});
export type UpdateAssistantConfigInput = z.infer<typeof updateAssistantConfigInput>;

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
  getAssistantConfig: {
    method: "GET",
    path: "/tenant-config/assistant",
    headers: tenantHeaders,
    responses: { 200: assistantConfigView },
    summary: "Configuración del asistente de WhatsApp (sin exponer la API key)",
  },
  updateAssistantConfig: {
    method: "PATCH",
    path: "/tenant-config/assistant",
    headers: tenantHeaders,
    body: updateAssistantConfigInput,
    responses: { 200: assistantConfigView },
    summary: "Actualiza base de conocimiento, proveedor y API key del asistente (ADMIN)",
  },
});
