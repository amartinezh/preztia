import { pgTable, uuid, text, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { cashBox } from "./cash-box";

// Arqueo de caja: foto del conteo físico contra el saldo del sistema en un momento dado.
// difference = counted − system (≠ 0 ⇒ descuadre). Append-only (bitácora). RLS FORCE.
export const cashCount = pgTable(
  "cash_count",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    cashBoxId: uuid("cash_box_id")
      .notNull()
      .references(() => cashBox.id),
    // Σ asientos de la caja al momento del arqueo (saldo Preztia).
    systemMinor: bigint("system_minor", { mode: "number" }).notNull(),
    // Conteo físico real reportado por el operador.
    countedMinor: bigint("counted_minor", { mode: "number" }).notNull(),
    // counted − system (positivo = sobrante; negativo = faltante).
    differenceMinor: bigint("difference_minor", { mode: "number" }).notNull(),
    notes: text("notes"),
    performedBy: uuid("performed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBoxIdx: index("cash_count_box_created_idx").on(t.cashBoxId, t.createdAt),
  }),
);
