import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { ltree } from "./zone";

// Totalidad de documentos del proceso KYC (debe coincidir con RequiredDocumentType
// del dominio). Solo un subconjunto se solicita hoy; el enum admite los futuros.
export const requiredDocument = pgEnum("required_document", [
  "IDENTITY_DOCUMENT",
  "BUSINESS_VALIDITY_CERTIFICATE",
  "BUSINESS_PHOTO",
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

// Sub-máquina de la NEGOCIACIÓN del plan de pago (Fase 10), independiente del `status` KYC del
// expediente: el `status` sigue en IN_REVIEW mientras se oferta/negocia; al crear el crédito pasa a
// APPROVED. NOT_OFFERED (inicial) → AWAITING_SELECTION (toggle ON) / AWAITING_ACCEPTANCE (toggle OFF
// o tras elegir) → ACCEPTED (bandera para el botón final) / DECLINED.
export const planOfferStatus = pgEnum("plan_offer_status", [
  "NOT_OFFERED",
  "AWAITING_SELECTION",
  "AWAITING_ACCEPTANCE",
  "ACCEPTED",
  "DECLINED",
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
    // Zona del canal (ltree), para scopear por alcance del usuario. Null si el canal no está
    // mapeado a una zona; solo el ADMIN (sin filtro) la ve en ese caso.
    zonePath: ltree("zone_path"),
    status: creditApplicationStatus("status").notNull().default("AWAITING_DOCUMENTS"),
    // Monto que el cliente declaró querer solicitar (unidades menores), capturado por WhatsApp.
    // Es solo la intención del cliente; el coordinador define el capital final al aprobar.
    requestedAmountMinor: bigint("requested_amount_minor", { mode: "number" }),
    // ── Negociación del plan de pago (Fase 10) ───────────────────────────────────────────────
    planOffer: planOfferStatus("plan_offer_status").notNull().default("NOT_OFFERED"),
    // Plan ofertado: el por defecto (toggle OFF) o el elegido por el cliente (toggle ON). Null hasta
    // que se fija. FK lógica a payment_plan (sin FK física: el plan puede editarse/borrarse después).
    offeredPlanId: uuid("offered_plan_id"),
    // Capital del préstamo que el coordinador puso al ofertar (unidades menores); base del cronograma.
    offeredPrincipalMinor: bigint("offered_principal_minor", { mode: "number" }),
    // Vencimiento de la oferta (now + planOfferTtlHours del tenant). Tras él la respuesta se ignora.
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    // Sello de la aceptación del cliente por WhatsApp (bandera para el botón final).
    clientAcceptedAt: timestamp("client_accepted_at", { withTimezone: true }),
    // ── Geolocalización compartida por WhatsApp (verificación geográfica) ─────────────────────
    // Coordenadas que el cliente comparte con la función nativa de WhatsApp (idealmente en su
    // negocio/domicilio). Fecha de negocio (no auditoría). El front pintará el marcador (fase post).
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    locationSharedAt: timestamp("location_shared_at", { withTimezone: true }),
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
    // Cuántos archivos componen el documento (copiado del catálogo al crear la solicitud, para
    // que un cambio posterior del catálogo no altere expedientes en curso). 2 = ambos lados.
    expectedFiles: integer("expected_files").notNull().default(1),
    // Cuántos archivos válidos se han recibido ya. VALIDATED cuando alcanza expected_files.
    receivedFiles: integer("received_files").notNull().default(0),
    // Envíos seguidos que la IA no reconoció como este documento. Se reinicia al validarlo:
    // sustituye al conteo histórico sobre document_extraction, que nunca se limpiaba.
    mismatchAttempts: integer("mismatch_attempts").notNull().default(0),
    // Referencia y ubicación del PRIMER archivo (en MinIO, cifrado en reposo). Se conserva
    // como atajo para los lectores de un solo archivo; el conjunto completo, incluido este,
    // vive en credit_application_document_file.
    mediaId: text("media_id"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sha256: text("sha256"),
    // Veredicto antifraude (auditable). 0..100; mayor = más riesgo.
    fraudScore: integer("fraud_score"),
    fraudReasons: jsonb("fraud_reasons").$type<string[]>(),
    // true si el documento se aceptó por insistencia del solicitante (la IA no lo
    // reconoció como el esperado) y queda marcado para revisión manual del analista.
    manualReview: boolean("manual_review").notNull().default(false),
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

// Cada ARCHIVO aceptado de un documento del checklist. Un documento puede constar de varios
// (anverso y reverso de la cédula), y hasta reunirlos todos no se da por validado. Es append-only:
// el rastro de qué binario llegó, cuándo y con qué hash es evidencia KYC, no estado mutable.
export const creditApplicationDocumentFile = pgTable(
  "credit_application_document_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => creditApplication.id),
    documentType: requiredDocument("document_type").notNull(),
    // Posición dentro del documento, 1..expected_files, en orden de llegada (1 = anverso).
    slot: integer("slot").notNull(),
    // Referencia y ubicación del binario (en MinIO, cifrado en reposo).
    mediaId: text("media_id").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un archivo por cupo: dos mensajes en carrera no pueden ocupar el mismo (el cupo se
    // asigna dentro de la transacción que bloquea la solicitud, así que además se serializan).
    slotIdx: uniqueIndex("credit_application_document_file_slot_idx").on(
      t.applicationId,
      t.documentType,
      t.slot,
    ),
    // Idempotencia: un mismo media de WhatsApp no se archiva dos veces en la solicitud.
    mediaIdx: uniqueIndex("credit_application_document_file_media_idx").on(
      t.applicationId,
      t.mediaId,
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
