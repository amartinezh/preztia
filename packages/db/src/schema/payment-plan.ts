import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { frequency } from "./credit";

// Plantilla de crédito ofertable por tenant (ej. "Plan 20 días"). El interés va en base-mil
// (200 = 20%), igual que credit.interest_pct y la comisión del tenant. Reusa el enum
// `frequency` del crédito (DAILY/WEEKLY/BIWEEKLY/MONTHLY) como única fuente de periodicidad.
export const paymentPlan = pgTable(
  "payment_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    installmentsCount: integer("installments_count").notNull(),
    frequency: frequency("frequency").notNull().default("DAILY"),
    interestPct: integer("interest_pct").notNull(), // base-mil
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Nombre único por tenant.
    byNameIdx: uniqueIndex("payment_plan_tenant_name_idx").on(t.tenantId, t.name),
    // INVARIANTE DURO (BD): a lo sumo UN plan por defecto por tenant (≤ 1). El ≥ 1 lo
    // garantizan los casos de uso (no borrar/desactivar/liberar el único default).
    oneDefaultIdx: uniqueIndex("payment_plan_one_default_idx")
      .on(t.tenantId)
      .where(sql`is_default = true`),
    byTenantIdx: index("payment_plan_tenant_idx").on(t.tenantId),
  }),
);
