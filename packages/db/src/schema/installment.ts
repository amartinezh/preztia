import { pgTable, uuid, bigint, integer, date, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { credit } from "./credit";

// Estado de una cuota de la cartera (espejo de InstallmentStatus del dominio).
export const installmentStatus = pgEnum("installment_status", [
  "PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
]);

// Cuota persistida del cronograma de un crédito otorgado. Los abonos de los
// pagos (PIX) acumulan en paid_minor; el invariante paid ≤ due lo garantiza el
// dominio y se refleja aquí solo como datos.
export const installment = pgTable(
  "installment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    creditId: uuid("credit_id")
      .notNull()
      .references(() => credit.id),
    seq: integer("seq").notNull(),
    // Fecha de negocio del vencimiento (no auditoría).
    dueDate: date("due_date").notNull(),
    amountDueMinor: bigint("amount_due_minor", { mode: "number" }).notNull(),
    paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
    status: installmentStatus("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Una cuota por posición dentro del crédito.
    bySeqIdx: uniqueIndex("installment_credit_seq_idx").on(t.creditId, t.seq),
    byCreditIdx: index("installment_tenant_credit_idx").on(t.tenantId, t.creditId),
  }),
);
