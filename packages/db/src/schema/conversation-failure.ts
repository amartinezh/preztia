import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { ltree } from "./zone";

// Etapa del flujo de WhatsApp en la que se rompió la atención. Se deriva del TIPO de mensaje
// que se estaba procesando, que es lo único que se conoce con certeza en la frontera del
// webhook (el único punto donde hoy se atrapan los fallos de procesamiento).
export const conversationFailureStage = pgEnum("conversation_failure_stage", [
  // Respuesta del asistente a un mensaje de texto.
  "ASSISTANT_REPLY",
  // Recepción de una imagen o archivo (documento KYC o comprobante de pago).
  "DOCUMENT_INTAKE",
  // Recepción de una nota de voz.
  "AUDIO_INTAKE",
  // Captura de la ubicación compartida.
  "LOCATION_CAPTURE",
  // Tipo no reconocido o fallo antes de poder clasificar.
  "UNKNOWN",
]);

/**
 * Bitácora APPEND-ONLY de los mensajes de WhatsApp que NO se pudieron atender por un fallo
 * técnico (excepción al procesar el mensaje entrante). Sin ella, esos casos solo existían en
 * los logs del proceso: la operación no podía distinguir a quien abandonó por voluntad propia
 * de quien se quedó a mitad de la solicitud porque el sistema falló.
 *
 * Lleva `tenant_id` + RLS como toda tabla de negocio y `zone_path` para scopear por el alcance
 * del usuario, igual que `conversation_message`.
 */
export const conversationFailure = pgTable(
  "conversation_failure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // phone_number_id del negocio (canal de WhatsApp).
    channelId: text("channel_id").notNull(),
    // teléfono del cliente (E.164 sin '+').
    applicantPhone: text("applicant_phone").notNull(),
    // Zona del canal (ltree). Null si el canal no está mapeado; solo el ADMIN la ve.
    zonePath: ltree("zone_path"),
    stage: conversationFailureStage("stage").notNull(),
    // Tipo del mensaje que se estaba atendiendo: text | audio | image | document | location.
    messageKind: text("message_kind").notNull(),
    // wamid del mensaje entrante que se perdió (traza para reprocesar manualmente).
    messageId: text("message_id"),
    // Clase del error (p. ej. `TypeError`, `DomainError`) y su mensaje, TRUNCADO: es un
    // diagnóstico para la operación, no un volcado de stack.
    errorName: text("error_name").notNull(),
    errorMessage: text("error_message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Recuperar los fallos de un cliente en orden cronológico (clasificación de la bandeja).
    byApplicantIdx: index("conversation_failure_applicant_idx").on(
      t.tenantId,
      t.applicantPhone,
      t.createdAt,
    ),
  }),
);
