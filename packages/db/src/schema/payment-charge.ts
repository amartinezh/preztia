import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bankProviderType } from "./tenant-bank-account";
import { credit } from "./credit";
import { payment } from "./payment";

// Ciclo de vida de una cobrança conversacional (cobro por WhatsApp con monto elegido por el
// cliente). Es también la SESIÓN del diálogo: mientras el cliente elige el monto, la fila está en
// AWAITING_SELECTION (sin cobrança generada aún).
//  - AWAITING_SELECTION: se ofreció el menú; se espera la elección del monto.
//  - PENDING:            cobrança generada en el proveedor (PIX copia-e-cola enviado); esperando pago.
//  - PAID:               el webhook confirmó el pago de esta cobrança.
//  - EXPIRED/CANCELED:   el código venció o se canceló (informado por el webhook).
//  - FAILED:             falló la generación de la cobrança en el proveedor.
export const paymentChargeStatus = pgEnum("payment_charge_status", [
  "AWAITING_SELECTION",
  "PENDING",
  "PAID",
  "EXPIRED",
  "CANCELED",
  "FAILED",
]);

// Cobro conversacional PIX iniciado desde WhatsApp: el cliente expresa que quiere pagar, elige un
// monto (una cuota / todo lo vencido / valor libre) y el sistema genera la cobrança en el proveedor
// (ej. PicPay `POST /charge/pix`) devolviendo el copia-e-cola. `payment_id` liga la cobrança al
// COMPROBANTE esperado (un pago UNVERIFIED con el monto esperado) para que la conciliación por
// settlement lo confirme cuando llegue el crédito real, respetando el toggle de conciliación. RLS.
export const paymentCharge = pgTable(
  "payment_charge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Crédito que se está pagando.
    creditId: uuid("credit_id")
      .notNull()
      .references(() => credit.id, { onDelete: "cascade" }),
    // Comprobante esperado (claim) creado al generar la cobrança; null mientras es solo sesión.
    paymentId: uuid("payment_id").references(() => payment.id),
    // Teléfono del pagador (E.164 sin '+') y canal de WhatsApp para notificarle.
    phone: text("phone").notNull(),
    channelId: text("channel_id").notNull(),
    provider: bankProviderType("provider").notNull(),
    // Identificador de la cobrança en el proveedor (idempotencia + emparejamiento del webhook).
    merchantChargeId: text("merchant_charge_id"),
    // Monto de la cobrança (unidades menores); null mientras la sesión espera la elección.
    amountMinor: bigint("amount_minor", { mode: "number" }),
    // Opciones ofrecidas en el menú (para interpretar "1"/"2"); se fijan al abrir la sesión.
    installmentMinor: bigint("installment_minor", { mode: "number" }),
    overdueMinor: bigint("overdue_minor", { mode: "number" }),
    currency: text("currency").notNull(),
    // Código PIX "copia e cola" devuelto por el proveedor.
    copyPaste: text("copy_paste"),
    status: paymentChargeStatus("status").notNull().default("AWAITING_SELECTION"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Una sola sesión ABIERTA (esperando elección) por (tenant, teléfono): el diálogo es único.
    openSessionIdx: uniqueIndex("payment_charge_open_session_idx")
      .on(t.tenantId, t.phone)
      .where(sql`status = 'AWAITING_SELECTION'`),
    // Emparejamiento del webhook: el merchantChargeId es único por tenant.
    byMerchantChargeIdx: uniqueIndex("payment_charge_tenant_merchant_idx")
      .on(t.tenantId, t.merchantChargeId)
      .where(sql`merchant_charge_id is not null`),
    // Listado de cobranças por crédito (auditoría/UI).
    byCreditIdx: index("payment_charge_credit_idx").on(t.creditId, t.createdAt),
  }),
);
