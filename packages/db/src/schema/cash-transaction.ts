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
import { cashCount } from "./cash-count";
import { payment } from "./payment";
import { expense } from "./expense";
import { credit } from "./credit";

// Sentido del asiento sobre la caja (el saldo es Σ: IN suma, OUT resta).
export const cashTxDirection = pgEnum("cash_tx_direction", ["IN", "OUT"]);

// Naturaleza del movimiento (gobierna reglas de motivo y trazabilidad al origen):
//  PAYMENT_IN   → abono de cliente (PIX/efectivo) que entra a una caja.
//  DISBURSEMENT → egreso por otorgamiento de crédito (liga a credit); sale de la caja/cuenta origen.
//  WITHDRAWAL   → retiro/egreso de dinero (exige motivo).
//  EXPENSE      → gasto aprobado (liga a expense).
//  TRANSFER     → movimiento entre cajas (dos asientos con el mismo transfer_group_id).
//  ADJUSTMENT   → ajuste por arqueo/conciliación (el historial no se edita: se ajusta).
//  UNIDENTIFIED → ingreso que no se pudo conciliar → caja TRANSIT.
//  DEBT_CLOSURE → cierre (solo ADMIN) de la deuda del cobrador en su caja de ruta.
export const cashTxKind = pgEnum("cash_tx_kind", [
  "PAYMENT_IN",
  "DISBURSEMENT",
  "WITHDRAWAL",
  "EXPENSE",
  "TRANSFER",
  "ADJUSTMENT",
  "UNIDENTIFIED",
  "DEBT_CLOSURE",
]);

// Cómo se cerró la deuda del cobrador: PAYROLL = recuperada por nómina (no afecta la utilidad);
// WRITE_OFF = condonada (pérdida del período).
export const debtClosureType = pgEnum("debt_closure_type", ["PAYROLL", "WRITE_OFF"]);

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
    // Crédito que originó el egreso DISBURSEMENT (de qué caja/cuenta salió el préstamo).
    creditId: uuid("credit_id").references(() => credit.id),
    // Arqueo que justifica un asiento ADJUSTMENT: el ajuste siempre nace de un descuadre
    // verificado (evidencia), nunca de un monto libre.
    cashCountId: uuid("cash_count_id").references(() => cashCount.id),
    // Las dos patas de una transferencia comparten transfer_group_id (Σ = 0).
    transferGroupId: uuid("transfer_group_id"),
    // Atribución SELLADA al postear (no se recalcula): zona del hecho de negocio (crédito,
    // gasto) o, si no hay, la de la caja; y cobrador dueño de la caja de ruta. Así la foto de
    // una liquidación no cambia si el crédito o la caja se reasignan después. Sin FK (RLS).
    zoneId: uuid("zone_id"),
    collectorId: uuid("collector_id"),
    // Obligatorio si y solo si kind = DEBT_CLOSURE (garantizado por CHECK).
    debtClosureType: debtClosureType("debt_closure_type"),
    // Quién registró el asiento (app_user); sin FK, igual que actor_id de audit_log.
    // NULL = asiento generado por el sistema (ruteo automático de un pago PIX / conciliación).
    createdBy: uuid("created_by"),
    // Reloj real AL INSERTAR (clock_timestamp), no el inicio de la transacción (now()): como todo
    // asiento a una caja se inserta bajo su advisory lock, el orden de created_at coincide con el
    // orden de los candados. La rendición del cobrador se apoya en eso para que "posterior al
    // corte" no pierda un cobro concurrente.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => ({
    byBoxIdx: index("cash_tx_box_created_idx").on(t.cashBoxId, t.createdAt),
    byTenantIdx: index("cash_tx_tenant_created_idx").on(t.tenantId, t.createdAt),
    // Liquidación por zona y rendición por cobrador: rangos de fecha por dimensión.
    byZoneIdx: index("cash_tx_zone_created_idx").on(t.zoneId, t.createdAt),
    byCollectorIdx: index("cash_tx_collector_created_idx").on(t.collectorId, t.createdAt),
    // Un pago se rutea a UNA sola caja (PAYMENT_IN o UNIDENTIFIED): idempotencia de dinero.
    byPaymentIdx: uniqueIndex("cash_tx_payment_idx")
      .on(t.paymentId)
      .where(sql`payment_id is not null`),
    // Un crédito se desembolsa UNA sola vez: idempotencia del egreso (sin doble desembolso).
    byCreditIdx: uniqueIndex("cash_tx_credit_idx")
      .on(t.creditId)
      .where(sql`credit_id is not null`),
    // Un gasto aprobado se paga UNA sola vez: idempotencia del egreso (sin doble cargo).
    byExpenseIdx: uniqueIndex("cash_tx_expense_idx")
      .on(t.expenseId)
      .where(sql`expense_id is not null`),
    // Un arqueo se ajusta a lo sumo UNA vez: idempotencia del ajuste (sin doble corrección).
    byCountIdx: uniqueIndex("cash_tx_count_idx")
      .on(t.cashCountId)
      .where(sql`cash_count_id is not null`),
    positive: check("cash_tx_amount_positive_chk", sql`amount_minor > 0`),
    // Se compara como TEXTO: un valor de enum recién agregado (ALTER TYPE … ADD VALUE) no puede
    // usarse en la misma transacción de migración; así esta migración aplica en un solo paso.
    debtClosureTyped: check(
      "cash_tx_debt_closure_type_chk",
      sql`(kind::text = 'DEBT_CLOSURE') = (debt_closure_type is not null)`,
    ),
  }),
);
