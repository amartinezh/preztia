import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// ─── Esquemas del payload de WhatsApp Cloud API (Meta) ──────────────────────
// Son tolerantes a propósito: Meta envía tipos de mensaje y eventos que no
// procesamos. Validamos lo que nos interesa y dejamos pasar el resto, de modo
// que el webhook siempre responda 200 y Meta no reintente.

const mediaObject = z.object({
  id: z.string(),
  mime_type: z.string(),
  sha256: z.string().optional(),
  voice: z.boolean().optional(), // presente en audio
  caption: z.string().optional(), // presente en imagen
  filename: z.string().optional(), // presente en document
});

const whatsappMessage = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    audio: mediaObject.optional(),
    image: mediaObject.optional(),
    document: mediaObject.optional(),
    // Ubicación compartida con la función nativa de WhatsApp (type === "location").
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const changeValue = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z.object({
      display_phone_number: z.string().optional(),
      phone_number_id: z.string(),
    }),
    messages: z.array(whatsappMessage).optional(),
    statuses: z.array(z.unknown()).optional(), // recibos de entrega/lectura: se ignoran
  })
  .passthrough();

const change = z.object({ field: z.string(), value: changeValue });
const entry = z.object({ id: z.string(), changes: z.array(change) });

export const whatsappWebhookEvent = z.object({
  object: z.string(),
  entry: z.array(entry),
});
export type WhatsappWebhookEvent = z.infer<typeof whatsappWebhookEvent>;
export type WhatsappMessage = z.infer<typeof whatsappMessage>;

// Query del handshake de verificación que Meta envía por GET.
export const whatsappVerifyQuery = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string(),
  "hub.challenge": z.string(),
});
export type WhatsappVerifyQuery = z.infer<typeof whatsappVerifyQuery>;

// ─── Contrato ts-rest: misma fuente de verdad para servidor y clientes ──────
export const whatsappWebhookContract = c.router({
  verify: {
    method: "GET",
    path: "/webhooks/whatsapp",
    query: whatsappVerifyQuery,
    responses: {
      200: z.string(), // se devuelve el `hub.challenge` en texto plano
      403: z.object({ message: z.string() }),
    },
    summary: "Handshake de verificación del webhook de WhatsApp (Meta)",
  },
  receive: {
    method: "POST",
    path: "/webhooks/whatsapp",
    body: whatsappWebhookEvent,
    responses: {
      200: z.object({ received: z.boolean() }),
    },
    summary: "Recepción de eventos de mensajes entrantes de WhatsApp",
  },
});
