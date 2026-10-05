import { pgTable, uuid, text, timestamp, pgEnum, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

// Proveedor de IA usado para atender el chat por texto. Por ahora se usa GEMINI
// (capa gratuita); OPENAI y CLAUDE quedan disponibles para el futuro.
export const aiProvider = pgEnum("ai_provider", ["GEMINI", "OPENAI", "CLAUDE"]);

// Ajustes operativos configurables por tenant (los toggles de "Configuración de cobro" del
// legado). Dinero en unidades menores; comisión en base-mil (200 = 20%) como el interés.
export interface OperationalSettings {
  readonly timeZone: string; // Zona horaria IANA de la EMPRESA: define el "hoy" y los cortes de todo el sistema
  readonly rechargesEnabled: boolean; // Activar Recargos
  readonly manualRoute: boolean; // Ruta Manual
  readonly blockBackdatedPayments: boolean; // Bloquear fechas atrasadas (solo el ADMIN fecha pagos a mano)
  readonly backdateMaxDays: number; // Días hacia atrás permitidos en la fecha de un pago (0–30)
  readonly relaxedPaymentDates: boolean; // Modo flexible: sin límite de días ni período sellado
  readonly blockInterestChange: boolean; // Bloquear Cambio De Interés (el interés sale de un plan activo)
  readonly adminCustomInterestAllowed: boolean; // Con el bloqueo, el ADMIN puede usar "Personalizado"
  readonly commissionPctBaseThousand: number; // Comisión por defecto del cobrador (base-mil)
  readonly commissionsEnabled: boolean; // ¿Se pagan comisiones a los cobradores? (default OFF)
  readonly commissionBase: "COLLECTED" | "REMITTED" | "PRINCIPAL_RECOVERED"; // Base por defecto de la comisión
  readonly commissionMaxPctBaseThousand: number; // Tope de comisión del ADMIN (base-mil; 0 = sin comisiones)
  readonly defaultCreditLimitMinor: number; // Cupo por Defecto
  readonly applyColorByOverdue: boolean; // Aplicar color a clientes con atrasos
  readonly clientChoosesPlan: boolean; // El cliente elige plan por WhatsApp (Fase 10)
  readonly planOfferTtlHours: number; // Vencimiento de la oferta de plan (horas; default 24)
  readonly allowAdminOverride: boolean; // Permitir crear crédito sin aceptación del cliente
  readonly autoConfirmSettlement: boolean; // Conciliar y abonar automáticamente los matches de settlement (default OFF)
  readonly visitOverdueThreshold: number; // Cuotas vencidas para agendar visita del cobrador (y umbral "crítico" del mapa)
  readonly remittanceDeadlineHourLocal: number; // Hora local (0–23) límite para que el cobrador rinda cuentas
  readonly settlementFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY"; // Período de liquidación
  readonly settlementAnchorDay: number; // Día de inicio del período (1–7 semanal; 1–28 mensual)
  readonly settlementAutoClose: boolean; // ¿Cierre automático al pasar el corte?
  readonly settlementStartDate: string | null; // Liquidar desde (YYYY-MM-DD); null = sin definir
}

// Configuración del recordatorio de cobro por WhatsApp (Cron por tenant). La hora es LOCAL de la
// empresa (`OperationalSettings.timeZone`), por lo que el cron horario evalúa `sendHourLocal` contra
// la hora actual en esa zona. La llave PIX se incluye en el mensaje para invitar al pago.
export interface CollectionReminderSettings {
  readonly enabled: boolean; // ¿Enviar recordatorios automáticos?
  readonly sendHourLocal: number; // Hora local de envío (0–23). Default: 7 (primera hora de la mañana).
  readonly pixKey: string | null; // Llave PIX del tenant para recibir el pago (se incluye en el mensaje).
}

export const DEFAULT_COLLECTION_REMINDER_SETTINGS: CollectionReminderSettings = {
  enabled: false,
  sendHourLocal: 7,
  pixKey: null,
};

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  timeZone: "America/Bogota",
  rechargesEnabled: false,
  manualRoute: false,
  blockBackdatedPayments: true,
  backdateMaxDays: 3,
  relaxedPaymentDates: false,
  blockInterestChange: true,
  adminCustomInterestAllowed: true,
  commissionPctBaseThousand: 0,
  commissionsEnabled: false,
  commissionBase: "COLLECTED",
  commissionMaxPctBaseThousand: 0,
  defaultCreditLimitMinor: 0,
  applyColorByOverdue: false,
  clientChoosesPlan: false,
  planOfferTtlHours: 24,
  allowAdminOverride: true,
  autoConfirmSettlement: false,
  visitOverdueThreshold: 3,
  remittanceDeadlineHourLocal: 20,
  settlementFrequency: "WEEKLY",
  settlementAnchorDay: 1,
  settlementAutoClose: true,
  settlementStartDate: null,
};

// Proveedores de mensajería habilitados en el tenant (ADR #40). Espejo de `MessagingChannelsSettings`
// del dominio, que valida sus invariantes (≥ 1 habilitado; el preferido para cobranza, habilitado).
export interface MessagingChannelsSettings {
  readonly whatsappEnabled: boolean;
  readonly telegramEnabled: boolean;
  readonly preferredProactiveChannel: "WHATSAPP" | "TELEGRAM";
}

// Solo WhatsApp: es el comportamiento de todos los tenants anteriores a Telegram.
export const DEFAULT_MESSAGING_CHANNELS: MessagingChannelsSettings = {
  whatsappEnabled: true,
  telegramEnabled: false,
  preferredProactiveChannel: "WHATSAPP",
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
    // Configuración del cron de cobranza por WhatsApp (hora local + zona horaria + llave PIX).
    collectionReminderSettings: jsonb("collection_reminder_settings")
      .$type<CollectionReminderSettings>()
      .notNull()
      .default(DEFAULT_COLLECTION_REMINDER_SETTINGS),
    // Idioma de atención al cliente por chat (código del catálogo del dominio: "es" | "pt-BR"). Todo
    // mensaje saliente lo lee en el momento de enviarse, así que cambiarlo aplica en caliente.
    clientLanguage: text("client_language").notNull().default("es"),
    // Proveedores de mensajería (WhatsApp/Telegram) habilitados. Default = DEFAULT_MESSAGING_CHANNELS.
    messagingChannels: jsonb("messaging_channels")
      .$type<MessagingChannelsSettings>()
      .notNull()
      .default(DEFAULT_MESSAGING_CHANNELS),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un phone_number_id mapea a un solo tenant.
    whatsappPhoneIdx: uniqueIndex("tenant_config_whatsapp_phone_idx").on(t.whatsappPhoneNumberId),
  }),
);
