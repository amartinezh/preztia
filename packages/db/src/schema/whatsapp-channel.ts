import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ltree } from "./zone";

// Canal de WhatsApp del tenant ligado a UNA zona: un `phone_number_id` atiende una zona. Resuelve
// tenant+zona desde el webhook y permite estampar `zone_path` en conversaciones y solicitudes para
// scopearlas por el alcance del usuario. Lleva tenant_id + RLS FORCE (política en la migración).
export const whatsappChannel = pgTable(
  "whatsapp_channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // phone_number_id del WhatsApp Business (único global en Meta).
    phoneNumberId: text("phone_number_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    // Path ltree de la zona (denormalizado para estampar/scopear rápido).
    zonePath: ltree("zone_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPhoneIdx: uniqueIndex("whatsapp_channel_phone_idx").on(t.phoneNumberId),
  }),
);
