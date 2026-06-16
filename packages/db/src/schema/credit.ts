import { pgTable, uuid, bigint, integer, date, timestamp, text, pgEnum } from "drizzle-orm/pg-core";

export const creditStatus = pgEnum("credit_status",
  ["PENDING", "ACTIVE", "SETTLED", "DEFAULTED", "CANCELLED"]);
export const frequency = pgEnum("frequency",
  ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]);

export const credit = pgTable("credit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  borrowerId: uuid("borrower_id").notNull(),
  zoneId: uuid("zone_id").notNull(),
  // Plan de pago del que salieron los términos (Fase 10); null en otorgamientos directos/legados.
  paymentPlanId: uuid("payment_plan_id"),
  principalMinor: bigint("principal_minor", { mode: "number" }).notNull(),
  interestPct: integer("interest_pct").notNull(),
  installmentsCount: integer("installments_count").notNull(),
  frequency: frequency("frequency").notNull().default("DAILY"),
  currency: text("currency").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: creditStatus("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
