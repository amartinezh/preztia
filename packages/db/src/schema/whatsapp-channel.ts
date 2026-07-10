import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ltree } from "./zone";

// Canal de WhatsApp del tenant ligado a UNA zona: un `phone_number_id` atiende una zona. Resuelve
// tenant+zona desde el webhook y permite estampar `zone_path` en conversaciones y solicitudes para
// scopearlas por el alcance del usuario. Lleva tenant_id + RLS FORCE (política en la migración).
//
// Credenciales de Meta (Graph API) por número, CIFRADAS en reposo (AES-256-GCM, `enc:v1:…`). Son
// NULLABLE: si faltan, el código cae a las variables de entorno (migración sin downtime). El verify
// token se guarda como HASH SHA-256 porque el handshake GET solo necesita comprobar existencia, no
// recuperarlo en claro. La versión de la Graph API es texto libre; null ⇒ default del código.
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
    // Access token de la Graph API (envío de texto y descarga de media). Cifrado.
    accessToken: text("access_token"),
    // App Secret para verificar la firma HMAC del webhook POST. Cifrado.
    appSecret: text("app_secret"),
    // Hash SHA-256 (hex) del verify token del handshake GET del webhook.
    verifyTokenSha256: text("verify_token_sha256"),
    // Versión de la Graph API (p. ej. "v21.0"); null ⇒ default del código.
    graphVersion: text("graph_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPhoneIdx: uniqueIndex("whatsapp_channel_phone_idx").on(t.phoneNumberId),
  }),
);
