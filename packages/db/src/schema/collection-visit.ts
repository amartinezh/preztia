import { pgTable, uuid, integer, timestamp, index } from "drizzle-orm/pg-core";

// Evento "cliente VISITADO" por el cobrador (append-only; la migración revoca UPDATE/DELETE al
// rol `app`). Cierra un ciclo de mora: se guarda el nº de cuotas vencidas al momento de visitar
// (`overdue_count_at_visit`), de modo que el cliente solo reaparece en "pendientes" cuando la mora
// crece otro umbral respecto a este valor (3 → 6 → 9 …). Lleva `tenant_id` + RLS FORCE (política en
// la migración). Es la traza de quién/cuándo/qué nivel de mora para el historial del admin.
export const collectionVisit = pgTable(
  "collection_visit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    creditId: uuid("credit_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    // Cobrador (app_user) que realizó la visita.
    collectorId: uuid("collector_id").notNull(),
    // Snapshot de la mora al visitar: base del reagendamiento por ciclo.
    overdueCountAtVisit: integer("overdue_count_at_visit").notNull(),
    daysOverdueAtVisit: integer("days_overdue_at_visit").notNull().default(0),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreditIdx: index("collection_visit_tenant_credit_idx").on(
      t.tenantId,
      t.creditId,
      t.visitedAt,
    ),
    byCollectorIdx: index("collection_visit_tenant_collector_idx").on(
      t.tenantId,
      t.collectorId,
    ),
  }),
);
