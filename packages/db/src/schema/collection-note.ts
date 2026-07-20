import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// Observaciones de VISITA de cobro por crédito (bitácora append-only). El cobrador registra en
// campo lo que observa del cliente; nunca se edita ni borra (la migración revoca UPDATE/DELETE al
// rol `app`). Alimenta el historial ordenado por fecha y habilita "marcar visitado" (debe existir
// una observación posterior a la última visita). Lleva `tenant_id` + RLS FORCE (política en la
// migración). `borrower_id` se guarda para el historial del cliente en la vista del admin.
export const collectionNote = pgTable(
  "collection_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    creditId: uuid("credit_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    // Autor de la observación (app_user que la registró: el cobrador).
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreditIdx: index("collection_note_tenant_credit_idx").on(
      t.tenantId,
      t.creditId,
      t.createdAt,
    ),
  }),
);
