import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Estado operativo del tenant. SUSPENDED bloquea el acceso de sus usuarios.
export const tenantStatus = pgEnum("tenant_status", ["ACTIVE", "SUSPENDED"]);

// Tabla GLOBAL del plano de control (no lleva tenant_id: su `id` ES el tenant). La
// gobierna el SUPER_ADMIN a través de la conexión de control-plane (BYPASSRLS). Bajo
// RLS, un ADMIN solo puede leer su propia fila (policy: id = current_tenant). El slug
// identifica al tenant de forma legible/estable.
export const tenant = pgTable(
  "tenant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: tenantStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySlugIdx: uniqueIndex("tenant_slug_idx").on(t.slug),
  }),
);
