import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenantBankAccount, bankProviderType } from "./tenant-bank-account";

// Bitácora APPEND-ONLY de los webhooks recibidos de los proveedores de pago (ej. PicPay
// `TransactionUpdateMessage`). Registra TODA notificación auténtica —pagada, cancelada,
// expirada— para trazabilidad de los pagos, aunque solo las PAID se normalicen a
// `incoming_credit`. Idempotencia de reentrega por (tenant, provider, event_id): un retry
// del proveedor no duplica el registro. RLS FORCE; sin secretos en `payload`.
export const providerWebhookEvent = pgTable(
  "provider_webhook_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => tenantBankAccount.id, { onDelete: "cascade" }),
    providerType: bankProviderType("provider_type").notNull(),
    // Identificador del evento en el proveedor (id del webhook / merchantChargeId+status).
    eventId: text("event_id").notNull(),
    // Tipo de evento del proveedor (ej. "TransactionUpdateMessage").
    eventType: text("event_type").notNull(),
    // Estado reportado (ej. PAID | CANCELED | EXPIRED); null si el payload no lo trae.
    status: text("status"),
    // Payload crudo del webhook (trazabilidad/auditoría); nunca credenciales.
    payload: jsonb("payload"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotencia de reentrega: un evento del proveedor se registra una sola vez.
    byEventIdx: uniqueIndex("provider_webhook_event_tenant_event_idx").on(
      t.tenantId,
      t.providerType,
      t.eventId,
    ),
    // Consulta de la bitácora por cuenta (pantalla de auditoría de pagos del proveedor).
    byAccountIdx: index("provider_webhook_event_account_idx").on(t.bankAccountId, t.receivedAt),
  }),
);
