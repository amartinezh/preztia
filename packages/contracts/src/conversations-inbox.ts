import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de la BANDEJA de WhatsApp: todas las comunicaciones del canal, agrupadas por
// cliente, scopeadas por la zona del usuario (ADMIN ve todo; COORDINATOR su(s) subárbol(es)).
// Además del listado, expone la ESTADÍSTICA de la cola (cuántos solo consultaron, cuántos se
// quedaron a medias, cuántos rompió un fallo técnico…) y la depuración de registros.

const phoneNumber = z.string().regex(/^\d{8,15}$/);

/**
 * Desenlace de una conversación: en qué terminó el contacto por WhatsApp. Es un valor DERIVADO
 * (no una columna): se calcula del estado de la solicitud del cliente y de si hubo fallos
 * técnicos registrados. El orden de precedencia lo fija el read model:
 *   APPROVED > REJECTED > PENDING_APPROVAL > TECHNICAL_FAILURE > INCOMPLETE > ONLY_INQUIRY
 * La falla técnica solo "gana" cuando la solicitud NO llegó a completarse: si el expediente
 * pasó a revisión o se aprobó, el fallo intermedio no cambia el desenlace.
 */
export const conversationOutcome = z.enum([
  // Solo preguntaron: nunca abrieron una solicitud de crédito.
  "ONLY_INQUIRY",
  // Un fallo técnico impidió terminar (o siquiera empezar) la solicitud.
  "TECHNICAL_FAILURE",
  // Abrieron la solicitud pero quedó incompleta (faltan documentos).
  "INCOMPLETE",
  // Expediente completo esperando decisión del coordinador.
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
]);
export type ConversationOutcome = z.infer<typeof conversationOutcome>;

/** Etapa del flujo en la que se rompió la atención (deriva del tipo de mensaje). */
export const conversationFailureStage = z.enum([
  "ASSISTANT_REPLY",
  "DOCUMENT_INTAKE",
  "AUDIO_INTAKE",
  "LOCATION_CAPTURE",
  "UNKNOWN",
]);
export type ConversationFailureStage = z.infer<typeof conversationFailureStage>;

export const conversationApplicationStatus = z.enum([
  "AWAITING_DOCUMENTS",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
]);

// Criterio de ordenación de la bandeja. Por defecto, la fecha/hora de la comunicación (`lastAt`)
// descendente: lo más reciente primero.
export const conversationSort = z.enum([
  "lastAt",
  "firstAt",
  "messageCount",
  "failures",
  "phone",
]);
export type ConversationSort = z.infer<typeof conversationSort>;

export const conversationOrder = z.enum(["asc", "desc"]);
export type ConversationOrder = z.infer<typeof conversationOrder>;

/**
 * Filtros de la bandeja, COMPARTIDOS por el listado, la estadística y la limpieza masiva: la
 * purga borra exactamente lo que el operador está viendo, sin poder divergir del criterio.
 */
export const conversationFilters = z.object({
  // Texto libre: teléfono del cliente o cuerpo de cualquiera de sus mensajes.
  search: z.string().trim().min(1).max(60).optional(),
  outcome: conversationOutcome.optional(),
  // Solo conversaciones con solicitud de crédito (atajo histórico, se mantiene).
  withApplication: z.coerce.boolean().optional(),
  // Canal (phone_number_id) por el que entró la conversación.
  channelId: z.string().trim().min(1).max(40).optional(),
  // Subárbol de zona (ltree). Debe estar dentro del alcance del usuario.
  zonePath: z.string().trim().min(1).max(200).optional(),
  // Rango de fechas de negocio (inclusive en ambos extremos, zona horaria del servidor).
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ConversationFilters = z.infer<typeof conversationFilters>;

export const listConversationsQuery = paginationQuery.merge(conversationFilters).extend({
  sort: conversationSort.default("lastAt"),
  order: conversationOrder.default("desc"),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuery>;

// Resumen de una conversación (un teléfono): actividad, desenlace y fallos técnicos.
export const conversationSummary = z.object({
  applicantPhone: z.string(),
  applicantPhoneMasked: z.string(),
  channelId: z.string(),
  zonePath: z.string().nullable(),
  messageCount: z.number().int(),
  inboundCount: z.number().int(),
  outboundCount: z.number().int(),
  /** Primer y último mensaje del rango consultado. */
  firstAt: z.string(),
  lastAt: z.string(),
  lastDirection: z.enum(["INBOUND", "OUTBOUND"]),
  lastKind: z.string(),
  lastBody: z.string().nullable(),
  /** Solicitud de crédito asociada (la más reciente), si existe. */
  applicationId: z.string().uuid().nullable(),
  applicationStatus: conversationApplicationStatus.nullable(),
  requestedAmountMinor: z.number().int().nullable(),
  /** Fallos técnicos registrados al atender a este cliente. */
  failureCount: z.number().int(),
  lastFailureAt: z.string().nullable(),
  lastFailureStage: conversationFailureStage.nullable(),
  lastFailureMessage: z.string().nullable(),
  outcome: conversationOutcome,
  /**
   * true si la conversación respalda un crédito ya aprobado: es evidencia KYC y la bandeja
   * NO la borra (ni individual ni masivamente).
   */
  protected: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

export const listConversationsOutput = z.object({
  items: z.array(conversationSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// ── Estadística de la cola ────────────────────────────────────────────────────────────────

/** Conteo de conversaciones por desenlace. Invariante: la suma === `totalConversations`. */
export const outcomeBreakdown = z.object({
  ONLY_INQUIRY: z.number().int(),
  TECHNICAL_FAILURE: z.number().int(),
  INCOMPLETE: z.number().int(),
  PENDING_APPROVAL: z.number().int(),
  APPROVED: z.number().int(),
  REJECTED: z.number().int(),
});
export type OutcomeBreakdown = z.infer<typeof outcomeBreakdown>;

export const conversationStatsOutput = z.object({
  totalConversations: z.number().int(),
  totalMessages: z.number().int(),
  inboundMessages: z.number().int(),
  outboundMessages: z.number().int(),
  /** Mensajes que no se pudieron atender por un fallo técnico (en el rango filtrado). */
  failedMessages: z.number().int(),
  byOutcome: outcomeBreakdown,
});
export type ConversationStatsOutput = z.infer<typeof conversationStatsOutput>;

// La estadística responde a los mismos filtros MENOS `outcome`: el desglose por desenlace
// pierde sentido si ya se filtró por uno.
export const conversationStatsQuery = conversationFilters.omit({ outcome: true });

// ── Hilo de la comunicación ───────────────────────────────────────────────────────────────

export const inboxMessage = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  kind: z.string(),
  body: z.string().nullable(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
});

export const inboxFailure = z.object({
  stage: conversationFailureStage,
  messageKind: z.string(),
  errorName: z.string(),
  errorMessage: z.string(),
  createdAt: z.string(),
});

export const conversationThreadOutput = z.object({
  applicantPhone: z.string(),
  entries: z.array(inboxMessage),
  /** Fallos técnicos del hilo, para intercalarlos cronológicamente con los mensajes. */
  failures: z.array(inboxFailure),
});
export type ConversationThreadOutput = z.infer<typeof conversationThreadOutput>;

// ── Depuración de registros ───────────────────────────────────────────────────────────────

// Tope del borrado por lotes: acota la transacción y el tamaño del cuerpo auditado.
const MAX_BATCH_PHONES = 200;

export const deleteConversationsInput = z.object({
  phones: z.array(phoneNumber).min(1).max(MAX_BATCH_PHONES),
});
export type DeleteConversationsInput = z.infer<typeof deleteConversationsInput>;

// Limpieza masiva: borra TODO lo que casa con los filtros actuales. `confirm` es obligatorio
// y explícito para que un cliente no pueda vaciar la bandeja por accidente.
export const purgeConversationsInput = conversationFilters.extend({
  confirm: z.literal(true),
});
export type PurgeConversationsInput = z.infer<typeof purgeConversationsInput>;

export const deletionResult = z.object({
  deletedConversations: z.number().int(),
  deletedMessages: z.number().int(),
  deletedFailures: z.number().int(),
  /** Conversaciones que se respetaron por respaldar un crédito aprobado. */
  skippedProtected: z.number().int(),
});
export type DeletionResult = z.infer<typeof deletionResult>;

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
  conversationStats: {
    method: "GET",
    path: "/conversations/stats",
    headers: tenantHeaders,
    query: conversationStatsQuery,
    responses: { 200: conversationStatsOutput },
    summary: "Estadística de la cola de conversaciones por desenlace",
  },
  getConversationThread: {
    method: "GET",
    path: "/conversations/thread",
    headers: tenantHeaders,
    query: z.object({ phone: phoneNumber }),
    responses: { 200: conversationThreadOutput },
    summary: "Hilo completo de mensajes con un cliente (scopeado por zona)",
  },
  deleteConversations: {
    method: "POST",
    path: "/conversations/delete",
    headers: tenantHeaders,
    body: deleteConversationsInput,
    responses: { 200: deletionResult },
    summary: "Borra una o varias conversaciones seleccionadas (ADMIN/COORDINATOR)",
  },
  purgeConversations: {
    method: "POST",
    path: "/conversations/purge",
    headers: tenantHeaders,
    body: purgeConversationsInput,
    responses: { 200: deletionResult },
    summary: "Limpia todas las conversaciones que casan con los filtros (ADMIN/COORDINATOR)",
  },
});
