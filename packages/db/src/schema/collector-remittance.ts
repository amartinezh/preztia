import {
  pgTable,
  uuid,
  text,
  bigint,
  date,
  jsonb,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cashBox } from "./cash-box";

// Estado de la rendición: el cobrador DECLARA (SUBMITTED) y el coordinador CUENTA y RECIBE.
export const remittanceStatus = pgEnum("remittance_status", ["SUBMITTED", "RECEIVED"]);

// Resumen del corte al declarar (espejo de `RemittanceSummary` del dominio).
export interface RemittanceSummarySnapshot {
  readonly openingMinor: number;
  readonly collectedMinor: number;
  readonly expensesMinor: number;
  readonly transferredOutMinor: number;
  readonly debtClosedMinor: number;
  readonly otherInMinor: number;
  readonly otherOutMinor: number;
  readonly expectedMinor: number;
}

// Rendición de cuentas del cobrador (corte de su caja de ruta). Cubre los movimientos desde el
// corte anterior; lo no entregado queda como saldo de la caja = deuda arrastrada. El dinero se
// mueve en el libro (TRANSFER ruta → oficina); esta tabla guarda el acto de rendir y la foto.
// Lleva tenant_id + RLS FORCE (política en la migración). Los cambios de estado van a audit_log.
export const collectorRemittance = pgTable(
  "collector_remittance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    collectorId: uuid("collector_id").notNull(),
    cashBoxId: uuid("cash_box_id")
      .notNull()
      .references(() => cashBox.id),
    // Zona de la caja de ruta al rendir (alcance del coordinador); NULL = caja sin zona.
    zoneId: uuid("zone_id"),
    status: remittanceStatus("status").notNull().default("SUBMITTED"),
    // Día de negocio (zona horaria del tenant) en que se declaró.
    businessDate: date("business_date").notNull(),
    // Límite que tenía la obligación al declarar; NULL si declaró sin cobros pendientes.
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Declaración del cobrador.
    summary: jsonb("summary").$type<RemittanceSummarySnapshot>().notNull(),
    declaredMinor: bigint("declared_minor", { mode: "number" }).notNull(),
    collectorNote: text("collector_note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    // Recepción del coordinador (NULL mientras está SUBMITTED).
    receivedBy: uuid("received_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    destinationCashBoxId: uuid("destination_cash_box_id").references(() => cashBox.id),
    // Esperado según el libro AL RECIBIR (incluye cobros hechos después de declarar).
    expectedAtReceptionMinor: bigint("expected_at_reception_minor", { mode: "number" }),
    countedMinor: bigint("counted_minor", { mode: "number" }),
    shortfallMinor: bigint("shortfall_minor", { mode: "number" }),
    // Saldo de la caja de ruta tras el corte (= deuda arrastrada en ese momento).
    closingBalanceMinor: bigint("closing_balance_minor", { mode: "number" }),
    // Instante del corte (clock_timestamp bajo el lock de la caja): lo posterior es del siguiente.
    cutAt: timestamp("cut_at", { withTimezone: true }),
    receiverNote: text("receiver_note"),
    transferGroupId: uuid("transfer_group_id"),
  },
  (t) => ({
    // A lo sumo UNA rendición declarada sin recibir por cobrador.
    oneOpen: uniqueIndex("collector_remittance_one_open_idx")
      .on(t.tenantId, t.collectorId)
      .where(sql`status = 'SUBMITTED'`),
    byCollector: index("collector_remittance_collector_idx").on(
      t.tenantId,
      t.collectorId,
      t.submittedAt,
    ),
    // RECEIVED ⇒ recepción completa y cuadrada (esperado = contado + faltante).
    receivedComplete: check(
      "collector_remittance_received_chk",
      sql`status <> 'RECEIVED' or (
        received_at is not null and received_by is not null and cut_at is not null
        and counted_minor >= 0 and shortfall_minor >= 0
        and expected_at_reception_minor = counted_minor + shortfall_minor
        and closing_balance_minor is not null)`,
    ),
    declaredNonNegative: check("collector_remittance_declared_chk", sql`declared_minor >= 0`),
  }),
);
