import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// FOTOGRAFÍA de un período de liquidación: lo que pasó con la plata y con el negocio entre dos
// cortes, sellado al cerrar. La foto se arma desde el libro de cajas (única fuente de verdad) y la
// cartera; nunca se recalcula ni se edita (la migración revoca UPDATE/DELETE al rol `app`). El
// JSONB es el `SettlementSnapshot` del dominio (settlement.ts), con la ruta de zona en cada línea
// para recortarlo al alcance del coordinador sin volver a la BD. Lleva tenant_id + RLS FORCE.
export const settlementPeriod = pgTable(
  "settlement_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Días de negocio del tenant, semiabierto [start, end).
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // Instantes UTC de los cortes (medianoche local): los asientos cuentan si caen en [starts, ends).
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Frecuencia vigente al cerrar (la configuración puede cambiar después).
    frequency: text("frequency").notNull(),
    // Cerrado después de su día de corte (reconstrucción de historia).
    retroactive: boolean("retroactive").notNull().default(false),
    // app_user que cerró; NULL = cierre automático del sistema.
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    currency: text("currency").notNull(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (t) => ({
    // Un período se cierra una sola vez (I10) y los cierres no se solapan: se encadenan por inicio.
    onePerStart: uniqueIndex("settlement_period_start_idx").on(t.tenantId, t.periodStart),
    byEnd: index("settlement_period_end_idx").on(t.tenantId, t.periodEnd),
    ordered: check("settlement_period_range_chk", sql`period_start < period_end and starts_at < ends_at`),
  }),
);
