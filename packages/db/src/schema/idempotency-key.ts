import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Resultado persistido por `Idempotency-Key` en endpoints de dinero. Un reintento con la misma
// clave devuelve la respuesta guardada sin re-ejecutar (sin doble cobro/abono/desembolso).
// Único por (tenant, key). Lleva tenant_id + RLS FORCE.
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byKeyIdx: uniqueIndex("idempotency_key_tenant_key_idx").on(t.tenantId, t.key),
  }),
);
