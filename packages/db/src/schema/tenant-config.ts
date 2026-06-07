import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";

// Proveedor de IA usado para atender el chat por texto. Por ahora se usa GEMINI
// (capa gratuita); OPENAI y CLAUDE quedan disponibles para el futuro.
export const aiProvider = pgEnum("ai_provider", ["GEMINI", "OPENAI", "CLAUDE"]);

// Configuración por tenant. Una fila por empresa (tenant_id es la PK y la clave RLS).
export const tenantConfig = pgTable(
  "tenant_config",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    // phone_number_id del WhatsApp Business del tenant: permite resolver el tenant
    // desde el webhook (que no envía tenant_id).
    whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
    // Base de conocimiento (texto largo): única fuente con la que el asistente puede
    // responder (cuotas, costos, requisitos del crédito).
    knowledgeBase: text("knowledge_base").notNull().default(""),
    // Proveedor y credencial de IA para analizar/responder el texto entrante.
    aiProvider: aiProvider("ai_provider").notNull().default("GEMINI"),
    aiApiKey: text("ai_api_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un phone_number_id mapea a un solo tenant.
    whatsappPhoneIdx: uniqueIndex("tenant_config_whatsapp_phone_idx").on(t.whatsappPhoneNumberId),
  }),
);
