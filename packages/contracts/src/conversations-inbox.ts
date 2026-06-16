import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de la BANDEJA de WhatsApp (vista 1): todas las comunicaciones del canal, agrupadas por
// cliente, scopeadas por la zona del usuario (ADMIN ve todo; COORDINATOR su(s) subárbol(es)).

// Resumen de una conversación (un teléfono): último mensaje, conteo y si tiene solicitud.
export const conversationSummary = z.object({
  applicantPhone: z.string(),
  applicantPhoneMasked: z.string(),
  zonePath: z.string().nullable(),
  messageCount: z.number().int(),
  lastDirection: z.enum(["INBOUND", "OUTBOUND"]),
  lastKind: z.string(),
  lastBody: z.string().nullable(),
  lastAt: z.string(),
  /** Estado de la solicitud de crédito asociada (si existe). */
  applicationStatus: z
    .enum(["AWAITING_DOCUMENTS", "IN_REVIEW", "APPROVED", "REJECTED"])
    .nullable(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

export const listConversationsOutput = z.object({
  items: z.array(conversationSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const listConversationsQuery = paginationQuery.extend({
  // Búsqueda por teléfono o texto de los mensajes.
  search: z.string().trim().min(1).max(60).optional(),
  // Solo conversaciones con solicitud de crédito.
  withApplication: z.coerce.boolean().optional(),
});

// Entrada del hilo (mensaje individual).
export const inboxMessage = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  kind: z.string(),
  body: z.string().nullable(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
});

export const conversationThreadOutput = z.object({
  applicantPhone: z.string(),
  entries: z.array(inboxMessage),
});
export type ConversationThreadOutput = z.infer<typeof conversationThreadOutput>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const conversationsInboxContract = c.router({
  listConversations: {
    method: "GET",
    path: "/conversations",
    headers: tenantHeaders,
    query: listConversationsQuery,
    responses: { 200: listConversationsOutput },
    summary: "Bandeja de conversaciones de WhatsApp (scopeada por zona)",
  },
  getConversationThread: {
    method: "GET",
    path: "/conversations/thread",
    headers: tenantHeaders,
    query: z.object({ phone: z.string().regex(/^\d{8,15}$/) }),
    responses: { 200: conversationThreadOutput },
    summary: "Hilo completo de mensajes con un cliente (scopeado por zona)",
  },
});
