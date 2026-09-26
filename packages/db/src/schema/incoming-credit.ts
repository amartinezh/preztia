import {
  pgTable,
  uuid,
  bigint,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantBankAccount } from "./tenant-bank-account";
import { payment } from "./payment";
import { fieldOrder } from "./field-order";

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
    // EndToEndId del PIX cuando la fuente lo trae (ej. webhook de PicPay). Permite el match
    // DETERMINISTA comprobante ↔ crédito por E2E; null cuando la fuente no lo expone (MP).
    endToEndId: text("end_to_end_id"),
    settlementDate: timestamp("settlement_date", { withTimezone: true }).notNull(),
    // Pago que consumió este crédito; NULL = aún disponible. Un crédito → un pago.
    consumedByPaymentId: uuid("consumed_by_payment_id").references(() => payment.id),
    // Orden de consignación del cobrador que consumió este crédito: el depósito NO es el pago de un
    // cliente, así que la conciliación de pagos debe ignorarlo (sin doble ingreso). Uno u otro.
    consumedByFieldOrderId: uuid("consumed_by_field_order_id").references(() => fieldOrder.id),
    // Fila cruda de la fuente (trazabilidad); sin secretos.
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotencia de ingestión: una fila por (tenant, source_id).
    bySourceIdx: uniqueIndex("incoming_credit_tenant_source_idx").on(t.tenantId, t.sourceId),
    // Listado de créditos disponibles por cuenta (consumed_by_payment_id IS NULL).
    byAccountIdx: index("incoming_credit_account_idx").on(t.bankAccountId, t.consumedByPaymentId),
    // Verificación per-PIX (PicPay): localizar un crédito por su endToEndId.
    byE2EIdx: index("incoming_credit_tenant_e2e_idx").on(t.tenantId, t.endToEndId),
    // Una orden consume a lo sumo un crédito.
    byFieldOrderIdx: uniqueIndex("incoming_credit_field_order_idx")
      .on(t.consumedByFieldOrderId)
      .where(sql`consumed_by_field_order_id is not null`),
    // Un crédito es de un pago O de una consignación, nunca de ambos.
    singleConsumer: check(
      "incoming_credit_single_consumer_chk",
      sql`consumed_by_payment_id is null or consumed_by_field_order_id is null`,
    ),
  }),
);
