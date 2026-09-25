import { ConflictError, DomainError } from "../shared/money";

/**
 * Proveedor de mensajería por el que entra/sale una conversación. El `channelId` que viaja por los
 * agregados (solicitud, pago, cobro, transcript) identifica el canal del NEGOCIO; su proveedor se
 * deriva de él sin consultar la BD (ADR #40):
 *   · WhatsApp → el `phone_number_id` de Meta, SIN prefijo (compatibilidad con los datos existentes).
 *   · Telegram → `tg:<bot_id>`. El prefijo evita colisiones: ambos identificadores son numéricos.
 */
export type MessagingProvider = "WHATSAPP" | "TELEGRAM";

export const TELEGRAM_CHANNEL_PREFIX = "tg:";

// El bot_id de Telegram es la parte numérica (entero positivo) previa a ':' en el token del bot.
const TELEGRAM_BOT_ID = /^[1-9]\d*$/;

/** Proveedor del canal. Falla rápido ante un `channelId` vacío o un `tg:` mal formado. */
export function channelProviderOf(channelId: string): MessagingProvider {
  if (channelId.startsWith(TELEGRAM_CHANNEL_PREFIX)) {
    assertTelegramBotId(channelId.slice(TELEGRAM_CHANNEL_PREFIX.length));
    return "TELEGRAM";
  }
  if (channelId.trim() === "") throw new DomainError("Canal de mensajería vacío");
  return "WHATSAPP";
}

/** `channelId` de un bot de Telegram a partir de su `bot_id`. */
export function telegramChannelId(botId: string): string {
  assertTelegramBotId(botId);
  return `${TELEGRAM_CHANNEL_PREFIX}${botId}`;
}

/** `bot_id` de un `channelId` de Telegram. Falla si el canal no es de Telegram. */
export function telegramBotIdOf(channelId: string): string {
  if (channelProviderOf(channelId) !== "TELEGRAM") {
    throw new DomainError("El canal no es de Telegram");
  }
  return channelId.slice(TELEGRAM_CHANNEL_PREFIX.length);
}

/**
 * Un canal de Telegram solo puede rotar el token de SU bot (tras /revoke en BotFather el bot_id se
 * conserva). Cambiar de bot cambiaría el `channelId` de las conversaciones y solicitudes existentes,
 * dejándolas sin canal: para eso se elimina el canal y se crea otro.
 */
export function assertSameTelegramBot(currentBotId: string, newBotId: string): void {
  if (currentBotId !== newBotId) {
    throw new ConflictError(
      "El token pertenece a otro bot: para cambiar de bot elimina el canal y crea uno nuevo",
      "TELEGRAM_BOT_MISMATCH",
    );
  }
}

function assertTelegramBotId(botId: string): void {
  if (!TELEGRAM_BOT_ID.test(botId)) {
    throw new DomainError("Identificador de bot de Telegram inválido");
  }
}
