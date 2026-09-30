import { pgTable, uuid, bigint, integer, date, timestamp, text, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const creditStatus = pgEnum("credit_status",
  ["PENDING", "ACTIVE", "SETTLED", "DEFAULTED", "CANCELLED"]);
export const frequency = pgEnum("frequency",
  ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]);
// Origen del crédito: ORIGINATED = otorgado en este sistema (sale dinero de una caja);
// MIGRATED = deuda cargada del sistema anterior (sin desembolso ni abonos en el libro de hoy).
export const creditOrigin = pgEnum("credit_origin", ["ORIGINATED", "MIGRATED"]);

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
  origin: creditOrigin("origin").notNull().default("ORIGINATED"),
  // Identificador del crédito en el sistema anterior (solo migrados): evita cargarlo dos veces.
  legacyReference: text("legacy_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byLegacyReference: uniqueIndex("credit_tenant_legacy_reference_idx")
    .on(t.tenantId, t.legacyReference)
    .where(sql`legacy_reference is not null`),
}));
