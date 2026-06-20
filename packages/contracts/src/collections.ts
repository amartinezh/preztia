import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de COBRANZA por WhatsApp (vista de Cartera/Gestión de Créditos). El historial del hilo
// se consulta con `getConversationThread` (contrato conversations-inbox); aquí va el panel de cobro
// de un crédito y el disparo MANUAL del recordatorio. El envío AUTOMÁTICO lo hace el cron (sin HTTP).

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

// Panel de cobranza de un crédito: cuánto debe hoy, su teléfono (para abrir el historial) y si se
// puede recordar. El teléfono va en claro porque el revisor (coordinador/ADMIN) ya está autorizado
// y lo necesita para el hilo; igual que `getConversationThread`.
export const creditCollectionPanel = z.object({
  creditId: z.string().uuid(),
  firstName: z.string(),
  phone: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  dueMinor: z.number().int(),
  currency: z.string(),
  /** ¿El tenant tiene llave PIX configurada? Sin ella no se puede enviar el recordatorio. */
  pixConfigured: z.boolean(),
});
export type CreditCollectionPanel = z.infer<typeof creditCollectionPanel>;

// Resultado del envío manual. `sent=false` con un motivo accionable para la UI (nada por cobrar,
// ya enviado hoy, sin teléfono). El texto enviado se devuelve para reflejarlo de inmediato.
export const sendReminderOutput = z.object({
  sent: z.boolean(),
  reason: z
    .enum(["NO_ACTIVE_CREDIT", "NOTHING_DUE", "NO_PIX_KEY", "ALREADY_SENT_TODAY"])
    .nullable(),
  phone: z.string().nullable(),
  dueMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  messagePreview: z.string().nullable(),
});
export type SendReminderOutput = z.infer<typeof sendReminderOutput>;

export const collectionsContract = c.router({
  getCreditCollection: {
    method: "GET",
    path: "/credits/:creditId/collection",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    responses: { 200: creditCollectionPanel },
    summary: "Panel de cobranza de un crédito: cuota de hoy, teléfono y estado PIX",
  },
  sendCollectionReminder: {
    method: "POST",
    path: "/credits/:creditId/collection-reminder",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: sendReminderOutput },
    summary:
      "Envía manualmente el recordatorio de cobro por WhatsApp (idempotente por crédito y día)",
  },
});
