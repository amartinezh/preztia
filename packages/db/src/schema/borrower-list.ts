import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Lista personalizada de clientes (segmentación). Lleva tenant_id + RLS FORCE.
export const borrowerList = pgTable(
  "borrower_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byNameIdx: uniqueIndex("borrower_list_tenant_name_idx").on(t.tenantId, t.name),
  }),
);

// Pertenencia cliente ↔ lista (un cliente puede estar en varias listas). Idempotente por
// (lista, cliente). Lleva tenant_id + RLS FORCE.
export const borrowerListMember = pgTable(
  "borrower_list_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    listId: uuid("list_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byMemberIdx: uniqueIndex("borrower_list_member_unique_idx").on(t.listId, t.borrowerId),
    byListIdx: index("borrower_list_member_tenant_list_idx").on(t.tenantId, t.listId),
  }),
);
