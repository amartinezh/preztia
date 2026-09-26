import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  date,
  doublePrecision,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { payment } from "./payment";

// Orden de ruta: el coordinador despacha paradas (clientes que necesitan visita) a uno o varios
// cobradores. La cabecera agrupa el despacho; el estado vive en cada parada.
// Lleva tenant_id + RLS FORCE (política en la migración).
export const collectionRoute = pgTable(
  "collection_route",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Zona de la propuesta (alcance del coordinador).
    zoneId: uuid("zone_id").notNull(),
    // Día de negocio para el que se despachó (zona horaria del tenant).
    serviceDate: date("service_date").notNull(),
    createdBy: uuid("created_by").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byZone: index("collection_route_zone_idx").on(t.tenantId, t.zoneId, t.dispatchedAt),
  }),
);

// Espejos de `StopStatus` / `StopOutcome` del dominio (route-stop.ts).
export const routeStopStatus = pgEnum("route_stop_status", ["ASSIGNED", "SEEN", "RESOLVED", "CANCELLED"]);
export const routeStopOutcome = pgEnum("route_stop_outcome", ["PAID", "NOT_PAID", "PROMISE", "NOT_FOUND"]);

// Parada de ruta asignada a un cobrador. Guarda una COPIA de lo que el cobrador puede ver del
// cliente (vista mínima): nombre, dirección, teléfono, coordenadas y monto a cobrar al despachar.
// Así la vista mínima nunca consulta el crédito ni al cliente (no filtra saldo ni historial).
export const routeStop = pgTable(
  "route_stop",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => collectionRoute.id),
    creditId: uuid("credit_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    collectorId: uuid("collector_id").notNull(),
    // Orden de visita propuesto (recorrido optimizado).
    sequence: integer("sequence").notNull(),
    status: routeStopStatus("status").notNull().default("ASSIGNED"),
    // Vista mínima (copia al despachar).
    clientName: text("client_name").notNull(),
    address: text("address"),
    phone: text("phone"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    amountToCollectMinor: bigint("amount_to_collect_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    // Liquidación de la visita.
    outcome: routeStopOutcome("outcome"),
    collectedMinor: bigint("collected_minor", { mode: "number" }),
    outcomeReason: text("outcome_reason"),
    promiseDate: date("promise_date"),
    note: text("note"),
    paymentId: uuid("payment_id").references(() => payment.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCollector: index("route_stop_collector_idx").on(t.tenantId, t.collectorId, t.status, t.sequence),
    byRoute: index("route_stop_route_idx").on(t.routeId, t.sequence),
    // Una sola parada abierta por crédito: no se despacha dos veces el mismo cliente.
    oneOpenPerCredit: uniqueIndex("route_stop_one_open_idx")
      .on(t.creditId)
      .where(sql`status in ('ASSIGNED', 'SEEN')`),
    // RESOLVED ⇒ resultado registrado; solo PAID lleva monto cobrado (> 0).
    resolved: check(
      "route_stop_resolved_chk",
      sql`status <> 'RESOLVED' or (outcome is not null and resolved_at is not null)`,
    ),
    paidAmount: check(
      "route_stop_paid_chk",
      sql`(outcome = 'PAID') = (collected_minor is not null and collected_minor > 0)
          or outcome is null`,
    ),
  }),
);
