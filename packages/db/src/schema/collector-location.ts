import {
  pgTable,
  uuid,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Punto del recorrido del cobrador (tracking GPS). Bitácora append-only: el cobrador registra
// su posición; el socio ve el recorrido del día ("Lugar último registro" = el más reciente).
// Lleva tenant_id + RLS FORCE (política en la migración).
export const collectorLocation = pgTable(
  "collector_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    collectorId: uuid("collector_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    // Momento en que se capturó la posición (auditoría).
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCollectorIdx: index("collector_location_tenant_collector_idx").on(
      t.tenantId,
      t.collectorId,
      t.recordedAt,
    ),
  }),
);
