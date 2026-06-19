import { pgTable, uuid, text, timestamp, pgEnum, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

// Proveedor de IA usado para atender el chat por texto. Por ahora se usa GEMINI
// (capa gratuita); OPENAI y CLAUDE quedan disponibles para el futuro.
export const aiProvider = pgEnum("ai_provider", ["GEMINI", "OPENAI", "CLAUDE"]);

// Ajustes operativos configurables por tenant (los toggles de "Configuración de cobro" del
// legado). Dinero en unidades menores; comisión en base-mil (200 = 20%) como el interés.
export interface OperationalSettings {
  readonly rechargesEnabled: boolean; // Activar Recargos
  readonly manualRoute: boolean; // Ruta Manual
  readonly blockOverdueDatesForSales: boolean; // Bloquear Fechas Atrasadas Para Ventas
  readonly blockInterestChange: boolean; // Bloquear Cambio De Interés
  readonly commissionPctBaseThousand: number; // Porcentaje Comisión (base-mil)
  readonly defaultCreditLimitMinor: number; // Cupo por Defecto
  readonly applyColorByOverdue: boolean; // Aplicar color a clientes con atrasos
  readonly clientChoosesPlan: boolean; // El cliente elige plan por WhatsApp (Fase 10)
  readonly planOfferTtlHours: number; // Vencimiento de la oferta de plan (horas; default 24)
  readonly allowAdminOverride: boolean; // Permitir crear crédito sin aceptación del cliente
}

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  rechargesEnabled: false,
  manualRoute: false,
  blockOverdueDatesForSales: true,
  blockInterestChange: true,
  commissionPctBaseThousand: 0,
  defaultCreditLimitMinor: 0,
  applyColorByOverdue: false,
  clientChoosesPlan: false,
  planOfferTtlHours: 24,
  allowAdminOverride: true,
};

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
    // Moneda del tenant (ISO 4217, ej. "COP"/"BRL"): toda la operación del tenant la usa.
    // Reemplaza el env global CREDIT_CURRENCY por una configuración por empresa (multi-país).
    currency: text("currency").notNull().default("COP"),
    // Proveedor y credencial de IA para analizar/responder el texto entrante.
    aiProvider: aiProvider("ai_provider").notNull().default("GEMINI"),
    aiApiKey: text("ai_api_key"),
    // Ajustes operativos (toggles de configuración de cobro). Default = DEFAULT_OPERATIONAL_SETTINGS.
    operationalSettings: jsonb("operational_settings")
      .$type<OperationalSettings>()
      .notNull()
      .default(DEFAULT_OPERATIONAL_SETTINGS),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un phone_number_id mapea a un solo tenant.
    whatsappPhoneIdx: uniqueIndex("tenant_config_whatsapp_phone_idx").on(t.whatsappPhoneNumberId),
  }),
);
