import {
  pgTable,
  uuid,
  bigint,
  integer,
  text,
  jsonb,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { installment } from "./installment";

// Estado del pago (espejo de PaymentStatus del dominio).
export const paymentStatus = pgEnum("payment_status", [
  "RECEIVED",
  "VERIFIED",
  "UNVERIFIED",
  "REJECTED_FRAUD",
  "REJECTED_INVALID",
]);

// Resultado de la última verificación contra el banco recaudador.
export const bankVerificationStatus = pgEnum("bank_verification_status", [
  "CONFIRMED",
  "NOT_FOUND",
  "UNAVAILABLE",
]);

// Pago reportado por el cliente vía comprobante (PIX). Guarda TODO lo extraído
// del comprobante (campos variables por banco emisor en extraction_raw), la
// evidencia (sha256 + storage_key del binario cifrado en MinIO) y el resultado
// de la verificación bancaria. payer_tax_id/payer_name son PII: jamás en logs.
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // null cuando el comprobante llegó sin crédito activo (huérfano auditado).
    creditId: uuid("credit_id"),
    // wamid del mensaje de WhatsApp que trajo el comprobante (traza).
    providerMessageId: text("provider_message_id"),
    // phone_number_id del canal: permite notificar al cliente en la conciliación.
    channelId: text("channel_id"),
    // Teléfono del pagador (E.164 sin '+').
    payerPhone: text("payer_phone").notNull(),
    // Monto extraído del comprobante; null si fue ilegible.
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: text("currency").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    payerName: text("payer_name"),
    payerTaxId: text("payer_tax_id"),
    payerBankName: text("payer_bank_name"),
    receiverPixKey: text("receiver_pix_key"),
    // Identificadores únicos de la transacción PIX (idempotencia de dinero).
    endToEndId: text("end_to_end_id"),
    txid: text("txid"),
    // Extracción completa de la IA (campos variables por banco emisor).
    extractionRaw: jsonb("extraction_raw"),
    sha256: text("sha256"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    status: paymentStatus("status").notNull().default("RECEIVED"),
    // Verificación bancaria (conciliación en línea o batch).
    bankStatus: bankVerificationStatus("bank_status"),
    bankResponse: jsonb("bank_response"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reconciliationAttempts: integer("reconciliation_attempts").notNull().default(0),
    lastReconciliationAt: timestamp("last_reconciliation_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un end_to_end_id PIX solo puede abonarse una vez por tenant.
    byEndToEndIdx: uniqueIndex("payment_tenant_end_to_end_idx")
      .on(t.tenantId, t.endToEndId)
      .where(sql`end_to_end_id is not null`),
    bySha256Idx: index("payment_tenant_sha256_idx").on(t.tenantId, t.sha256),
    byStatusIdx: index("payment_tenant_status_idx").on(t.tenantId, t.status),
  }),
);

// Asignación de una porción del pago a una cuota (auditable, append-only de facto).
export const paymentAllocation = pgTable(
  "payment_allocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payment.id),
    installmentId: uuid("installment_id")
      .notNull()
      .references(() => installment.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un pago abona una sola vez a una misma cuota.
    byPaymentInstallmentIdx: uniqueIndex("payment_allocation_payment_installment_idx").on(
      t.paymentId,
      t.installmentId,
    ),
  }),
);

// Bitácora append-only de movimientos y cambios de estado de pagos (auditabilidad
// financiera). Igual que credit_application_event: nunca se edita ni se borra.
export const paymentEvent = pgTable(
  "payment_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id"),
    creditId: uuid("credit_id"),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPaymentIdx: index("payment_event_payment_idx").on(t.paymentId),
  }),
);
