import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// Totalidad de documentos del proceso KYC (debe coincidir con RequiredDocumentType
// del dominio). Solo un subconjunto se solicita hoy; el enum admite los futuros.
export const requiredDocument = pgEnum("required_document", [
  "IDENTITY_DOCUMENT",
  "BUSINESS_VALIDITY_CERTIFICATE",
  "PUBLIC_SERVICES_RECEIPT",
  "BANK_STATEMENT",
  "INCOME_PROOF",
]);

export const creditApplicationStatus = pgEnum("credit_application_status", [
  "AWAITING_DOCUMENTS",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
]);

export const documentStatus = pgEnum("document_status", [
  "PENDING",
  "RECEIVED",
  "VALIDATED",
  "REJECTED",
]);

// Solicitud de crédito iniciada desde WhatsApp. Una activa por (tenant, solicitante).
export const creditApplication = pgTable(
  "credit_application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // phone_number_id del negocio (canal de WhatsApp).
    channelId: text("channel_id").notNull(),
    // teléfono del solicitante (E.164 sin '+').
    applicantPhone: text("applicant_phone").notNull(),
    status: creditApplicationStatus("status").notNull().default("AWAITING_DOCUMENTS"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Garantiza una sola solicitud ACTIVA por solicitante (idempotencia del inicio).
    activeApplicantIdx: uniqueIndex("credit_application_active_applicant_idx")
      .on(t.tenantId, t.applicantPhone)
      .where(sql`status in ('AWAITING_DOCUMENTS', 'IN_REVIEW')`),
  }),
);

// Cada documento del checklist de una solicitud, con su estado y metadatos KYC.
export const creditApplicationDocument = pgTable(
  "credit_application_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => creditApplication.id),
    documentType: requiredDocument("document_type").notNull(),
    status: documentStatus("status").notNull().default("PENDING"),
    // Referencia y ubicación del binario (en MinIO, cifrado en reposo).
    mediaId: text("media_id"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sha256: text("sha256"),
    // Veredicto antifraude (auditable). 0..100; mayor = más riesgo.
    fraudScore: integer("fraud_score"),
    fraudReasons: jsonb("fraud_reasons").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un documento por tipo dentro de la solicitud.
    documentByTypeIdx: uniqueIndex("credit_application_document_type_idx").on(
      t.applicationId,
      t.documentType,
    ),
  }),
);

// Idempotencia de webhooks: registra cada wamid procesado por tenant.
export const processedInboundMessage = pgTable(
  "processed_inbound_message",
  {
    tenantId: uuid("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.messageId] }),
  }),
);

// Bitácora append-only de cambios de estado de la solicitud (auditabilidad).
export const creditApplicationEvent = pgTable(
  "credit_application_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byApplicationIdx: index("credit_application_event_application_idx").on(t.applicationId),
  }),
);
