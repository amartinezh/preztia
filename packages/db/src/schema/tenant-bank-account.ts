import { pgTable, uuid, text, boolean, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Política para pagos que el banco aún no confirma (UNVERIFIED):
//  - HOLD: no se abonan cuotas hasta que la conciliación los verifique (default).
//  - ALLOCATE: se abonan de inmediato con el monto extraído (útil en desarrollo
//    o para tenants que asumen el riesgo).
export const unverifiedPaymentPolicy = pgEnum("unverified_payment_policy", ["HOLD", "ALLOCATE"]);

// Cuenta bancaria recaudadora del tenant, organizada por país y entidad
// (ej. BR + INTER). La conciliación resuelve el verificador por (country, bank).
// api_key sigue el precedente de tenant_config.ai_api_key (en claro bajo RLS);
// mejora futura: cifrarla en reposo.
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
    // Llave PIX recaudadora del tenant: llave de emparejamiento de pagos entrantes
    // por WhatsApp (receiver_pix_key del comprobante → esta cuenta).
    pixKey: text("pix_key"),
    // Credencial para consultar el API del banco.
    apiKey: text("api_key"),
    unverifiedPolicy: unverifiedPaymentPolicy("unverified_policy").notNull().default("HOLD"),
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
