import { pgTable, uuid, text, timestamp, customType } from "drizzle-orm/pg-core";

// Tipo ltree (no nativo en drizzle): lo declaramos como custom type
export const ltree = customType<{ data: string }>({ dataType: () => "ltree" });

export const zone = pgTable("zone", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parentZoneId: uuid("parent_zone_id"),
  path: ltree("path").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const zoneCoordinator = pgTable("zone_coordinator", {
  zoneId: uuid("zone_id").notNull(),
  coordinatorId: uuid("coordinator_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
});
