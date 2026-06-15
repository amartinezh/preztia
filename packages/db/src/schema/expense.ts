import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// Estado del gasto (maker-checker): el cobrador solicita PENDING; el revisor aprueba/rechaza.
export const expenseStatus = pgEnum("expense_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// Gasto de cobro ("Solicitud Gastos"). Solo los APPROVED entran como `gastos` de la liquidada.
// Lleva tenant_id + RLS FORCE (política en la migración).
export const expense = pgTable(
  "expense",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Quien solicita el gasto (app_user cobrador).
    requestedBy: uuid("requested_by").notNull(),
    description: text("description").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    status: expenseStatus("status").notNull().default("PENDING"),
    // Revisor (app_user) y momento de la decisión (NULL mientras está PENDING).
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatusIdx: index("expense_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
  }),
);
