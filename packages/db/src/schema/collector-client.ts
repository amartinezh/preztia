import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Asignación cobrador → cliente (deudor). El coordinador crea cobradores y les asigna
// el conjunto de clientes que pueden gestionar; el cobrador SOLO ve esos clientes. El
// alcance por cliente es authZ de aplicación (RLS solo aísla por tenant). `borrower_id`
// referencia al deudor (mismo identificador que usa `credit.borrower_id`).
export const collectorClient = pgTable(
  "collector_client",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    collectorId: uuid("collector_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    // Quién hizo la asignación (coordinador/admin) — trazabilidad.
    assignedBy: uuid("assigned_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un cliente se asigna a un cobrador una sola vez por tenant.
    byCollectorBorrowerIdx: uniqueIndex("collector_client_unique_idx").on(
      t.tenantId,
      t.collectorId,
      t.borrowerId,
    ),
  }),
);
