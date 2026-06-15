import {
  pgTable,
  uuid,
  bigint,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Liquidada (cierre de caja, "Nueva Liquidada"). Bitácora append-only encadenada: cada cierre
// parte del saldo de la anterior (`caja_anterior = caja_actual previa`) y cubre la ventana
// (period_start, period_end]. A nivel tenant (collector_id NULL = toda la operación).
// Lleva tenant_id + RLS FORCE (política en la migración).
export const settlement = pgTable(
  "settlement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Ruta/cobrador del cierre (NULL = liquidada de todo el tenant). Reservado para Fase 4.
    collectorId: uuid("collector_id"),
    // Ventana de movimientos incluidos (exclusiva-inclusiva): (period_start, period_end].
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    cajaAnteriorMinor: bigint("caja_anterior_minor", { mode: "number" }).notNull(),
    totalCobradoMinor: bigint("total_cobrado_minor", { mode: "number" }).notNull(),
    totalPrestadoMinor: bigint("total_prestado_minor", { mode: "number" }).notNull(),
    gastosMinor: bigint("gastos_minor", { mode: "number" }).notNull(),
    cajaActualMinor: bigint("caja_actual_minor", { mode: "number" }).notNull(),
    cuentasNuevas: integer("cuentas_nuevas").notNull().default(0),
    cuentasTerminadas: integer("cuentas_terminadas").notNull().default(0),
    // Quién cerró la liquidada (app_user).
    closedBy: uuid("closed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreatedIdx: index("settlement_tenant_created_idx").on(t.tenantId, t.createdAt),
  }),
);
