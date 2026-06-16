import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";
import { grantCreditInput } from "./credit";

const c = initContract();

// Tipos de documento del proceso KYC (espejo de `requiredDocument` en @preztiaos/db
// y de `RequiredDocumentType` del dominio).
export const requiredDocumentType = z.enum([
  "IDENTITY_DOCUMENT",
  "BUSINESS_VALIDITY_CERTIFICATE",
  "PUBLIC_SERVICES_RECEIPT",
  "BANK_STATEMENT",
  "INCOME_PROOF",
]);
export type RequiredDocumentTypeContract = z.infer<typeof requiredDocumentType>;

// Estado del documento dentro del expediente.
export const documentStatus = z.enum(["PENDING", "RECEIVED", "VALIDATED", "REJECTED"]);

// Estado del expediente KYC.
export const creditApplicationStatus = z.enum([
  "AWAITING_DOCUMENTS",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
]);
export type CreditApplicationStatus = z.infer<typeof creditApplicationStatus>;

// Veredicto del pipeline antifraude (espejo de `validationStatus`/`FraudStatus`).
export const verdictStatus = z.enum(["approved", "suspicious", "rejected"]);
export type VerdictStatus = z.infer<typeof verdictStatus>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

// ── Listado: resumen de cada intento con su veredicto vigente ───────────────
export const applicationReviewSummary = z.object({
  id: z.string().uuid(),
  // Teléfono enmascarado (privacidad): solo se exponen los últimos dígitos en listados.
  applicantPhoneMasked: z.string(),
  status: creditApplicationStatus,
  latestVerdictStatus: verdictStatus.nullable(),
  latestVerdictScore: z.number().int().nullable(),
  documentsTotal: z.number().int(),
  // Documentos con sospecha de fraude (score > 0) o en revisión manual.
  documentsFlagged: z.number().int(),
  createdAt: z.string(),
});
export type ApplicationReviewSummary = z.infer<typeof applicationReviewSummary>;

export const listApplicationsOutput = z.object({
  items: z.array(applicationReviewSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// Filtro del listado por estado (en proceso = AWAITING_DOCUMENTS, completas = IN_REVIEW, etc.).
export const listApplicationsQuery = paginationQuery.extend({
  status: creditApplicationStatus.optional(),
});

// ── Histórico de rechazos ───────────────────────────────────────────────────
export const rejectionSummary = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  applicantPhoneMasked: z.string(),
  reason: z.string(),
  decidedBy: z.string().uuid(),
  createdAt: z.string(),
});
export type RejectionSummary = z.infer<typeof rejectionSummary>;

export const listRejectionsOutput = z.object({
  items: z.array(rejectionSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// ── Detalle: alerta del pipeline atribuida a un documento ───────────────────
export const validationAlertView = z.object({
  documento: z.string(),
  campo: z.string(),
  severidad: z.string(),
  detalle: z.string(),
});

// Una corrida del pipeline (append-only): el historial de por qué se marcó.
export const validationRunView = z.object({
  id: z.string().uuid(),
  status: verdictStatus,
  score: z.number().int(),
  alerts: z.array(validationAlertView),
  consultedSources: z.array(z.string()),
  createdAt: z.string(),
});
export type ValidationRunView = z.infer<typeof validationRunView>;

// Detalle de cada documento del expediente, con su veredicto y trazabilidad de extracción.
export const applicationDocumentDetail = z.object({
  documentType: requiredDocumentType,
  status: documentStatus,
  fraudScore: z.number().int().nullable(),
  fraudReasons: z.array(z.string()).nullable(),
  manualReview: z.boolean(),
  mimeType: z.string().nullable(),
  // true si hay binario original almacenado para abrir.
  hasOriginal: z.boolean(),
  identifiedType: z.string().nullable(),
  matchesExpected: z.boolean().nullable(),
  confidence: z.number().int().nullable(),
});
export type ApplicationDocumentDetail = z.infer<typeof applicationDocumentDetail>;

export const applicationReviewDetail = z.object({
  id: z.string().uuid(),
  // Teléfono completo: el coordinador está autorizado a verlo en el detalle.
  applicantPhone: z.string(),
  status: creditApplicationStatus,
  createdAt: z.string(),
  documents: z.array(applicationDocumentDetail),
  // Historial completo de corridas del pipeline (orden desc; la primera es la vigente).
  verdictHistory: z.array(validationRunView),
});
export type ApplicationReviewDetail = z.infer<typeof applicationReviewDetail>;

// ── Conversación: transcript con el cliente ─────────────────────────────────
export const conversationEntry = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  kind: z.string(),
  body: z.string().nullable(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversationEntry = z.infer<typeof conversationEntry>;

export const conversationOutput = z.object({
  entries: z.array(conversationEntry),
});

// ── Decisiones del coordinador ──────────────────────────────────────────────
// Aprobar reusa los términos del crédito (fuente única) y añade el motivo de la decisión.
export const approveApplicationInput = grantCreditInput.extend({
  reason: z.string().min(3).max(500),
});
export type ApproveApplicationInput = z.infer<typeof approveApplicationInput>;

export const approveApplicationOutput = z.object({
  applicationId: z.string().uuid(),
  creditId: z.string().uuid(),
  status: creditApplicationStatus,
});

export const rejectApplicationInput = z.object({
  reason: z.string().min(3).max(500),
});
export type RejectApplicationInput = z.infer<typeof rejectApplicationInput>;

export const rejectApplicationOutput = z.object({
  applicationId: z.string().uuid(),
  status: creditApplicationStatus,
});

const idParam = z.object({ id: z.string().uuid() });

// Contrato ts-rest de la revisión antifraude de cartera: misma fuente de verdad para
// API (NestJS) y cliente (móvil/web). El binario del documento original NO va aquí
// (se sirve por una ruta dedicada que descifra y streamea).
export const creditApplicationReviewContract = c.router({
  listApplications: {
    method: "GET",
    path: "/applications",
    headers: tenantHeaders,
    query: listApplicationsQuery,
    responses: { 200: listApplicationsOutput },
    summary: "Lista paginada de intentos de solicitud con su veredicto antifraude (filtrable por estado)",
  },
  listRejections: {
    method: "GET",
    path: "/applications-rejections",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listRejectionsOutput },
    summary: "Histórico de rechazos de solicitudes (motivo + quién + cuándo)",
  },
  getApplicationReview: {
    method: "GET",
    path: "/applications/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    responses: { 200: applicationReviewDetail },
    summary: "Detalle completo de un expediente para revisión (documentos + historial de veredictos)",
  },
  getApplicationConversation: {
    method: "GET",
    path: "/applications/:id/conversation",
    pathParams: idParam,
    headers: tenantHeaders,
    responses: { 200: conversationOutput },
    summary: "Transcript de la conversación con el cliente del expediente",
  },
  approveApplication: {
    method: "POST",
    path: "/applications/:id/approval",
    pathParams: idParam,
    headers: tenantHeaders,
    body: approveApplicationInput,
    responses: { 200: approveApplicationOutput },
    summary: "Aprueba el expediente y genera el crédito (decisión manual del coordinador)",
  },
  rejectApplication: {
    method: "POST",
    path: "/applications/:id/rejection",
    pathParams: idParam,
    headers: tenantHeaders,
    body: rejectApplicationInput,
    responses: { 200: rejectApplicationOutput },
    summary: "Rechaza el expediente (decisión manual del coordinador)",
  },
});
