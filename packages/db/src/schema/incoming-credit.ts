import {
  pgTable,
  uuid,
  bigint,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenantBankAccount } from "./tenant-bank-account";
import { payment } from "./payment";

// Crédito real liberado por la fuente de liquidación (una fila del settlement_report). Es el
// GROUND TRUTH de la Fase 2: un comprobante (payment) solo se confirma si matchea un crédito de
// aquí, por monto exacto. Idempotencia de INGESTIÓN por (tenant, source_id); CONSUMO a lo sumo
// una vez vía `consumed_by_payment_id` (un crédito valida un solo pago). RLS FORCE.
export const incomingCredit = pgTable(
  "incoming_credit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => tenantBankAccount.id, { onDelete: "cascade" }),
    // Identificador único de la fila en la fuente (SOURCE_ID del reporte).
    sourceId: text("source_id").notNull(),
    // Monto bruto (lo que envió el pagador) y neto liquidado, en unidades menores.
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    netAmountMinor: bigint("net_amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    // "bank_transfer" para PIX; se conserva para el filtro de elegibilidad.
    paymentMethodType: text("payment_method_type").notNull(),
    // Tipo de transacción de la fuente (excluye REFUND/CHARGEBACK en el match).
    transactionType: text("transaction_type").notNull(),
    settlementDate: timestamp("settlement_date", { withTimezone: true }).notNull(),
    // Pago que consumió este crédito; NULL = aún disponible. Un crédito → un pago.
    consumedByPaymentId: uuid("consumed_by_payment_id").references(() => payment.id),
    // Fila cruda de la fuente (trazabilidad); sin secretos.
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotencia de ingestión: una fila por (tenant, source_id).
    bySourceIdx: uniqueIndex("incoming_credit_tenant_source_idx").on(t.tenantId, t.sourceId),
    // Listado de créditos disponibles por cuenta (consumed_by_payment_id IS NULL).
    byAccountIdx: index("incoming_credit_account_idx").on(t.bankAccountId, t.consumedByPaymentId),
  }),
);
