import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// Notas de cobro del cliente (Notas del legado). Bitácora append-only: nunca se edita ni borra;
// el repositorio solo inserta y lista. Lleva `tenant_id` + RLS FORCE (política en la migración).
export const borrowerNote = pgTable(
  "borrower_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    // Autor de la nota (app_user que la registró).
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBorrowerIdx: index("borrower_note_tenant_borrower_idx").on(
      t.tenantId,
      t.borrowerId,
      t.createdAt,
    ),
  }),
);
