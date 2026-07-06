import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Política para pagos que el banco aún no confirma (UNVERIFIED):
//  - HOLD: no se abonan cuotas hasta que la conciliación los verifique (default).
//  - ALLOCATE: se abonan de inmediato con el monto extraído (útil en desarrollo
//    o para tenants que asumen el riesgo).
export const unverifiedPaymentPolicy = pgEnum("unverified_payment_policy", ["HOLD", "ALLOCATE"]);

// Tipo de PROVEEDOR/integración de la cuenta. Decide QUÉ adaptador y capacidades aplican
// (qué credenciales pide, si tiene reporte de liquidación, etc.), desacoplado de la identidad
// del banco (bankName/bankCode):
//  - MANUAL:      sin integración por API; conciliación manual.
//  - INTER:       API del Banco Inter (saldo + verificación por PIX).
//  - MERCADOPAGO: API de Mercado Pago (settlement_report; sin saldo en tiempo real).
//  - PICPAY:      API Pix de PicPay (webhook de cobranças con endToEndId; sin saldo por API).
// Extensible: un proveedor nuevo agrega un valor al enum (migración).
export const bankProviderType = pgEnum("bank_provider_type", ["MANUAL", "INTER", "MERCADOPAGO", "PICPAY"]);

// Configuración NO secreta del reporte de liquidación del proveedor (ej. Mercado Pago
// settlement_report). Los secretos viven cifrados en `bank_credential`; esto solo parametriza
// la generación/lectura del reporte.
export interface BankReportConfig {
  // Prefijo del archivo de reporte en la cuenta del proveedor.
  prefix?: string;
  // Idioma de los encabezados del CSV (fijarlo ata el parser a un set conocido).
  reportTranslation?: "en" | "es" | "pt";
  // Zona horaria para acotar la ventana del reporte.
  timezone?: string;
  // Tamaño de la ventana de conciliación, en días.
  windowDays?: number;
}

// Cuenta bancaria recaudadora del tenant, organizada por país y entidad
// (ej. BR + INTER). La conciliación resuelve el verificador por (country, bank).
// `api_key` se guarda CIFRADA en reposo (AES-256-GCM, prefijo `enc:v1:`). Para proveedores
// con varias credenciales (ej. Mercado Pago: public_key + access_token) los secretos viven,
// también cifrados, en `bank_credential` (N por cuenta).
export const tenantBankAccount = pgTable(
  "tenant_bank_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Etiqueta legible para el CRUD del admin (ej. "Inter Principal").
    label: text("label").notNull(),
    // Nombre del banco tal como lo ve el operador (ej. "Banco Inter").
    bankName: text("bank_name").notNull(),
    // Número de cuenta real en la entidad (informativo / conciliación manual).
    accountNumber: text("account_number"),
    // ISO 3166-1 alpha-2 (ej. "BR").
    countryCode: text("country_code").notNull(),
    // Código interno de la entidad (ej. "INTER").
    bankCode: text("bank_code").notNull(),
    // Proveedor/integración que aplica a esta cuenta (resuelve el adaptador).
    providerType: bankProviderType("provider_type").notNull().default("MANUAL"),
    // Llave PIX recaudadora del tenant: llave de emparejamiento de pagos entrantes
    // por WhatsApp (receiver_pix_key del comprobante → esta cuenta).
    pixKey: text("pix_key"),
    // Identidad del RECEBEDOR para el match antifraude del comprobante: el CPF/CNPJ y el
    // titular del recibo deben coincidir con esta cuenta. PII: nunca en logs.
    receiverTaxId: text("receiver_tax_id"),
    receiverName: text("receiver_name"),
    // Credencial para consultar el API del banco.
    apiKey: text("api_key"),
    // Parámetros NO secretos del reporte de liquidación (ver BankReportConfig).
    reportConfig: jsonb("report_config").$type<BankReportConfig>(),
    unverifiedPolicy: unverifiedPaymentPolicy("unverified_policy").notNull().default("HOLD"),
    // Toggles de validación por cuenta (panel de configuración):
    //  - verifyPaymentsEnabled: ¿esta cuenta participa en la VALIDACIÓN de pagos entrantes
    //    (verificación per-PIX y conciliación por settlement)? Permite elegir con cuál(es)
    //    entidades se valida un pago sin desactivar la cuenta.
    //  - balanceCheckEnabled: ¿se permite la VALIDACIÓN de saldo (sincronización contra el
    //    saldo real del banco) para esta cuenta?
    verifyPaymentsEnabled: boolean("verify_payments_enabled").notNull().default(true),
    balanceCheckEnabled: boolean("balance_check_enabled").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Una cuenta por (tenant, país, banco).
    byBankIdx: uniqueIndex("tenant_bank_account_tenant_bank_idx").on(t.tenantId, t.countryCode, t.bankCode),
    // Emparejamiento de pagos PIX entrantes: una llave receptora apunta a una sola cuenta.
    byPixKeyIdx: uniqueIndex("tenant_bank_account_tenant_pix_idx")
      .on(t.tenantId, t.pixKey)
      .where(sql`pix_key is not null`),
  }),
);
