import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { requiredDocument } from "./credit-application";
import { aiProvider } from "./tenant-config";

// Información extraída de un documento KYC por la IA. Es la fuente de TRAZABILIDAD:
// se guarda todo lo extraído, identificando el teléfono desde el que se envió, para
// auditoría y futuro apoyo al antifraude.
//
// Datos NO ESTRUCTURADOS → `jsonb`: el conjunto de campos varía por tipo de documento
// y país (Brasil hoy), así que se guarda como JSON flexible (consultable e indexable
// con GIN si hiciera falta) en `fields`, y la respuesta cruda del modelo en `raw_response`.
export const documentExtraction = pgTable(
  "document_extraction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    documentType: requiredDocument("document_type").notNull(),
    // Teléfono del solicitante (E.164 sin '+') desde el que se envió el documento.
    applicantPhone: text("applicant_phone").notNull(),
    // wamid del media de WhatsApp del que proviene el documento.
    mediaId: text("media_id"),
    // Proveedor y modelo de IA usados (trazabilidad / reproducibilidad).
    provider: aiProvider("provider").notNull(),
    model: text("model"),
    // Qué documento identificó la IA y si coincide con el esperado del checklist.
    identifiedType: text("identified_type"),
    matchesExpected: boolean("matches_expected"),
    // Confianza 0..100 (entero; evita coma flotante).
    confidence: integer("confidence"),
    // Datos extraídos (no estructurados) y respuesta cruda del modelo.
    fields: jsonb("fields").$type<Record<string, unknown>>(),
    // Metadata técnica del archivo (Producer/fechas; forense de la Etapa 2).
    fileMetadata: jsonb("file_metadata").$type<Record<string, unknown>>(),
    rawText: text("raw_text"),
    rawResponse: jsonb("raw_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byApplicationIdx: index("document_extraction_application_idx").on(t.applicationId),
    byApplicantIdx: index("document_extraction_applicant_idx").on(t.tenantId, t.applicantPhone),
  }),
);
