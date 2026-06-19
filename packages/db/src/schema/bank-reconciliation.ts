import { pgTable, uuid, bigint, jsonb, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { cashBox } from "./cash-box";

// Resultado de una sincronización del saldo bancario en línea:
//  MATCHED     → el saldo real del banco coincide con el del sistema.
//  MISMATCH    → hay descuadre (difference ≠ 0): la UI lo resalta para investigar.
//  UNAVAILABLE → el banco no respondió / sin credencial (no concluye nada).
export const bankSyncStatus = pgEnum("bank_sync_status", ["MATCHED", "MISMATCH", "UNAVAILABLE"]);

// Conciliación bancaria en línea (botón "Sincronizar Saldo"). Append-only: cada sync deja
// una foto comparando el saldo Preztia contra el saldo real traído por API. RLS FORCE.
export const bankReconciliation = pgTable(
  "bank_reconciliation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    cashBoxId: uuid("cash_box_id")
      .notNull()
      .references(() => cashBox.id),
    // Σ asientos de la caja al momento de sincronizar (saldo Preztia).
    systemMinor: bigint("system_minor", { mode: "number" }).notNull(),
    // Saldo real traído del banco; NULL si UNAVAILABLE.
    bankMinor: bigint("bank_minor", { mode: "number" }),
    // bank − system; NULL si UNAVAILABLE.
    differenceMinor: bigint("difference_minor", { mode: "number" }),
    status: bankSyncStatus("status").notNull(),
    // Respuesta cruda del banco (trazabilidad); sin PII de terceros en logs.
    rawResponse: jsonb("raw_response"),
    syncedBy: uuid("synced_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBoxIdx: index("bank_reconciliation_box_created_idx").on(t.cashBoxId, t.createdAt),
  }),
);
