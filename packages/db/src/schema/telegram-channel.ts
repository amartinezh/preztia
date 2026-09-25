import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ltree } from "./zone";

// Bot de Telegram del tenant ligado a UNA zona (ADR #40): el análogo de `whatsapp_channel`. Un bot
// atiende una zona y una zona tiene a lo sumo un bot. Lleva tenant_id + RLS FORCE (política en la
// migración escrita a mano).
//
// El `channel_id` (`tg:<bot_id>`) es lo que viaja en los agregados (solicitud, pago, transcript),
// igual que el phone_number_id de WhatsApp. El update de Telegram NO dice a qué bot llegó, por eso
// cada bot tiene su propia URL de webhook con un id opaco (`webhook_hook_id`) que no es el token.
//
// Secretos CIFRADOS en reposo (AES-256-GCM, `enc:v1:…`): el token del bot y el secret token del
// webhook (se guarda recuperable porque hay que reenviarlo a Telegram al rotar el token del bot).
export const telegramChannel = pgTable(
  "telegram_channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // bot_id de Telegram (parte numérica del token; lo confirma getMe). Único global.
    botId: text("bot_id").notNull(),
    // `tg:<bot_id>`: identificador del canal en los agregados.
    channelId: text("channel_id").notNull(),
    // @username del bot (de getMe), para mostrar el enlace t.me/<username>.
    botUsername: text("bot_username"),
    zoneId: uuid("zone_id").notNull(),
    // Path ltree de la zona (denormalizado para estampar/scopear rápido).
    zonePath: ltree("zone_path").notNull(),
    // Token del bot (Bot API). Cifrado.
    botToken: text("bot_token").notNull(),
    // Id opaco de la URL del webhook (/webhooks/telegram/:hookId). Aleatorio, único.
    webhookHookId: text("webhook_hook_id").notNull(),
    // Secret token del webhook (header X-Telegram-Bot-Api-Secret-Token). Cifrado.
    webhookSecret: text("webhook_secret").notNull(),
    // Instante en que Telegram aceptó el setWebhook; null ⇒ el bot aún no recibe mensajes.
    webhookRegisteredAt: timestamp("webhook_registered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBotIdx: uniqueIndex("telegram_channel_bot_idx").on(t.botId),
    byChannelIdx: uniqueIndex("telegram_channel_channel_idx").on(t.channelId),
    byHookIdx: uniqueIndex("telegram_channel_hook_idx").on(t.webhookHookId),
    // Un bot por zona.
    byZoneIdx: uniqueIndex("telegram_channel_zone_idx").on(t.zoneId),
  }),
);

// Vínculo chat de Telegram ⇄ teléfono verificado (ADR #40, D1). Telegram no entrega el teléfono del
// remitente: el usuario comparte SU contacto (botón request_contact) y desde ahí el sistema lo
// identifica por teléfono, igual que en WhatsApp. Sin nombre ni username (minimización de PII).
export const telegramChatLink = pgTable(
  "telegram_chat_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // `tg:<bot_id>` del bot por el que se habla.
    channelId: text("channel_id").notNull(),
    // chat_id de Telegram (int64) como texto: evita perder precisión en JS.
    chatId: text("chat_id").notNull(),
    // Teléfono verificado (E.164 sin '+'); null hasta que el usuario comparte su contacto.
    phone: text("phone"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // El usuario bloqueó el bot (403 al enviar); se limpia si vuelve a escribir.
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byChatIdx: uniqueIndex("telegram_chat_link_chat_idx").on(t.channelId, t.chatId),
    // Un teléfono tiene a lo sumo un chat vigente por bot (el último contacto verificado gana).
    byPhoneIdx: uniqueIndex("telegram_chat_link_phone_idx")
      .on(t.channelId, t.phone)
      .where(sql`phone IS NOT NULL`),
    // Resolución del canal alcanzable de un cliente (cobranza/proactivos).
    byTenantPhoneIdx: index("telegram_chat_link_tenant_phone_idx").on(t.tenantId, t.phone),
  }),
);
