import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// Bitácora transversal APPEND-ONLY de operaciones de escritura (quién/qué/cuándo/tenant +
// correlación). Se escribe desde un interceptor en cada mutación HTTP exitosa. La migración
// REVOCA UPDATE/DELETE al rol `app` (solo INSERT/SELECT): el historial no se edita ni borra.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Actor (app_user) derivado del JWT; null si la operación no estaba autenticada.
    actorId: uuid("actor_id"),
    // Acción y entidad afectada (p. ej. action="POST /credits", entity="credits").
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    // Estado resultante (cuerpo de la petición saneado, sin secretos).
    payload: jsonb("payload"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantIdx: index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt),
  }),
);
