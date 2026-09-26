import {
  pgTable,
  uuid,
  text,
  bigint,
  jsonb,
  timestamp,
  pgEnum,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cashBox } from "./cash-box";

// Tipo de orden al cobrador. DEPOSIT = consignar efectivo de su caja de ruta en una cuenta PIX.
export const fieldOrderKind = pgEnum("field_order_kind", ["DEPOSIT"]);

// Espejo de `FieldOrderStatus` del dominio (máquina de estados en deposit-order.ts).
export const fieldOrderStatus = pgEnum("field_order_status", [
  "ISSUED",
  "SEEN",
  "REPORTED",
  "DISPUTED",
  "VERIFIED",
  "CANCELLED",
]);

// Orden del coordinador al cobrador (control del dinero en la calle). El estado vigente vive aquí;
// la historia completa (quién/qué/cuándo, comentarios) vive en `field_order_event` (append-only).
// Lleva tenant_id + RLS FORCE (política en la migración).
export const fieldOrder = pgTable(
  "field_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    kind: fieldOrderKind("kind").notNull(),
    status: fieldOrderStatus("status").notNull().default("ISSUED"),
    collectorId: uuid("collector_id").notNull(),
    // Caja de ruta de la que sale el efectivo a consignar.
    routeCashBoxId: uuid("route_cash_box_id")
      .notNull()
      .references(() => cashBox.id),
    // Zona de la caja de ruta al emitir (alcance del coordinador); NULL = caja sin zona.
    zoneId: uuid("zone_id"),
    // Cuenta destino (caja BANK) que fija el coordinador.
    destinationCashBoxId: uuid("destination_cash_box_id")
      .notNull()
      .references(() => cashBox.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    instructions: text("instructions"),
    issuedBy: uuid("issued_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    // Último reporte del cobrador (se reemplaza si reporta de nuevo tras una objeción; los
    // anteriores quedan en la bitácora).
    reportedAmountMinor: bigint("reported_amount_minor", { mode: "number" }),
    depositedAt: timestamp("deposited_at", { withTimezone: true }),
    depositReference: text("deposit_reference"),
    receiptStorageKey: text("receipt_storage_key"),
    receiptMimeType: text("receipt_mime_type"),
    receiptSha256: text("receipt_sha256"),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    // Verificación del coordinador: el TRANSFER ruta → banco queda trazado por su grupo.
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedAmountMinor: bigint("verified_amount_minor", { mode: "number" }),
    transferGroupId: uuid("transfer_group_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCollector: index("field_order_collector_idx").on(t.tenantId, t.collectorId, t.issuedAt),
    byStatus: index("field_order_status_idx").on(t.tenantId, t.status, t.issuedAt),
    positive: check("field_order_amount_chk", sql`amount_minor > 0`),
    // VERIFIED ⇒ verificación completa (el dinero ya se movió en el libro).
    verifiedComplete: check(
      "field_order_verified_chk",
      sql`status <> 'VERIFIED' or (verified_at is not null and verified_by is not null
        and verified_amount_minor > 0 and transfer_group_id is not null)`,
    ),
  }),
);

// Eventos de la orden (bitácora de comunicación entre coordinador y cobrador).
export const fieldOrderEventType = pgEnum("field_order_event_type", [
  "ISSUED",
  "SEEN",
  "REPORTED",
  "DISPUTED",
  "VERIFIED",
  "CANCELLED",
  "COMMENT",
]);

// Bitácora APPEND-ONLY de la orden: cada transición y cada comentario con actor y fecha/hora. La
// migración revoca UPDATE/DELETE al rol `app`. Lleva tenant_id + RLS FORCE.
export const fieldOrderEvent = pgTable(
  "field_order_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => fieldOrder.id),
    type: fieldOrderEventType("type").notNull(),
    actorId: uuid("actor_id").notNull(),
    message: text("message"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOrder: index("field_order_event_order_idx").on(t.orderId, t.createdAt),
  }),
);
