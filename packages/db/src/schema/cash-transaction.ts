import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cashBox } from "./cash-box";
import { payment } from "./payment";
import { expense } from "./expense";

// Sentido del asiento sobre la caja (el saldo es Σ: IN suma, OUT resta).
export const cashTxDirection = pgEnum("cash_tx_direction", ["IN", "OUT"]);

// Naturaleza del movimiento (gobierna reglas de motivo y trazabilidad al origen):
//  PAYMENT_IN   → abono de cliente (PIX/efectivo) que entra a una caja.
//  WITHDRAWAL   → retiro/egreso de dinero (exige motivo).
//  EXPENSE      → gasto aprobado (liga a expense).
//  TRANSFER     → movimiento entre cajas (dos asientos con el mismo transfer_group_id).
//  ADJUSTMENT   → ajuste por arqueo/conciliación (el historial no se edita: se ajusta).
//  UNIDENTIFIED → ingreso que no se pudo conciliar → caja TRANSIT.
export const cashTxKind = pgEnum("cash_tx_kind", [
  "PAYMENT_IN",
  "WITHDRAWAL",
  "EXPENSE",
  "TRANSFER",
  "ADJUSTMENT",
  "UNIDENTIFIED",
]);

// Libro mayor APPEND-ONLY de la caja (auditabilidad financiera). El saldo de cada caja
// es Σ de sus asientos firmados por `direction`; nunca un campo mutable. La migración
// REVOCA UPDATE/DELETE al rol `app` (solo INSERT/SELECT). Lleva tenant_id + RLS FORCE.
export const cashTransaction = pgTable(
  "cash_transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    cashBoxId: uuid("cash_box_id")
      .notNull()
      .references(() => cashBox.id),
    direction: cashTxDirection("direction").notNull(),
    kind: cashTxKind("kind").notNull(),
    // Siempre positivo (el signo lo aporta `direction`). Garantizado por CHECK.
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    // Motivo/justificación: OBLIGATORIO para caja menor (CASH) y retiros (validado en dominio).
    reason: text("reason"),
    // Trazas al origen del movimiento (a lo sumo una poblada).
    paymentId: uuid("payment_id").references(() => payment.id),
    expenseId: uuid("expense_id").references(() => expense.id),
    // Las dos patas de una transferencia comparten transfer_group_id (Σ = 0).
    transferGroupId: uuid("transfer_group_id"),
    // Quién registró el asiento (app_user); sin FK, igual que actor_id de audit_log.
    // NULL = asiento generado por el sistema (ruteo automático de un pago PIX / conciliación).
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBoxIdx: index("cash_tx_box_created_idx").on(t.cashBoxId, t.createdAt),
    byTenantIdx: index("cash_tx_tenant_created_idx").on(t.tenantId, t.createdAt),
    // Un pago se rutea a UNA sola caja (PAYMENT_IN o UNIDENTIFIED): idempotencia de dinero.
    byPaymentIdx: uniqueIndex("cash_tx_payment_idx")
      .on(t.paymentId)
      .where(sql`payment_id is not null`),
    positive: check("cash_tx_amount_positive_chk", sql`amount_minor > 0`),
  }),
);
