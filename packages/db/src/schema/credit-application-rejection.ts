import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// Histórico de RECHAZOS de solicitudes de crédito (decisión manual del coordinador/admin). Motivo
// obligatorio para retroalimentar. Append-only; lleva tenant_id + RLS FORCE (política en migración).
export const creditApplicationRejection = pgTable(
  "credit_application_rejection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    // Motivo del rechazo (obligatorio en la frontera).
    reason: text("reason").notNull(),
    // Quién rechazó (app_user ADMIN/COORDINATOR).
    decidedBy: uuid("decided_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantIdx: index("credit_application_rejection_tenant_idx").on(t.tenantId, t.createdAt),
  }),
);
