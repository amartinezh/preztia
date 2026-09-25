import { sql, type SQL } from 'drizzle-orm';

/**
 * ¿Se le puede escribir al teléfono `phone` por el canal `channelId`? (ADR #40). Expresión SQL
 * COMPARTIDA por la cobranza por lote y por el resolvedor de avisos, para que ambos apliquen la
 * misma definición. Se evalúa dentro de la transacción del tenant (RLS):
 *   · Telegram (`tg:…`): el bot existe y el teléfono compartió su contacto con él sin bloquearlo;
 *   · WhatsApp: el número sigue vinculado al tenant.
 */
export function channelReachableSql(channelId: SQL, phone: SQL): SQL {
  return sql`CASE
    WHEN ${channelId} IS NULL THEN false
    WHEN ${channelId} LIKE 'tg:%' THEN EXISTS (
      SELECT 1 FROM telegram_chat_link l
      JOIN telegram_channel t ON t.channel_id = l.channel_id
      WHERE l.channel_id = ${channelId} AND l.phone = ${phone} AND l.blocked_at IS NULL)
    ELSE EXISTS (SELECT 1 FROM whatsapp_channel w WHERE w.phone_number_id = ${channelId})
  END`;
}
