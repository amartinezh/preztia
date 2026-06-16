import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { ltree } from "./zone";

// Sentido del mensaje en la conversación de WhatsApp.
export const conversationDirection = pgEnum("conversation_direction", [
  "INBOUND",
  "OUTBOUND",
]);

// Transcript completo de la comunicación por cliente: cada mensaje ENTRANTE (lo que el
// cliente envía) y SALIENTE (lo que respondemos). Es una bitácora append-only para
// trazabilidad/auditoría; lleva tenant_id + RLS como toda tabla de negocio.
export const conversationMessage = pgTable(
  "conversation_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // phone_number_id del negocio (canal de WhatsApp).
    channelId: text("channel_id").notNull(),
    // teléfono del cliente (E.164 sin '+').
    applicantPhone: text("applicant_phone").notNull(),
    // Zona del canal (ltree), para scopear por el alcance del usuario. Null si el canal no está
    // mapeado a una zona todavía (solo el ADMIN, sin filtro, las ve).
    zonePath: ltree("zone_path"),
    direction: conversationDirection("direction").notNull(),
    // Tipo de mensaje: text | audio | image | document.
    kind: text("kind").notNull(),
    // Texto del mensaje (cuerpo de texto, caption de imagen o nombre de archivo).
    body: text("body"),
    // Referencia al media de WhatsApp (cuando aplica) y su mime.
    mediaId: text("media_id"),
    mimeType: text("mime_type"),
    // wamid del mensaje entrante (traza/idempotencia); null para los salientes.
    messageId: text("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Recuperar la conversación de un cliente en orden cronológico.
    byApplicantIdx: index("conversation_message_applicant_idx").on(
      t.tenantId,
      t.applicantPhone,
      t.createdAt,
    ),
  }),
);
