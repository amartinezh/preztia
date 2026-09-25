import {
  type InboundMessage,
  TelegramContactRejectedError,
  telegramInboundMessageId,
  verifiedPhoneOf,
} from "@preztiaos/domain";
import type {
  TelegramChatLinkStore,
  TelegramContactInbound,
  TelegramContactPrompter,
  TelegramContentInbound,
  TelegramInbound,
} from "./ports";

/**
 * Caso de uso: identificar al remitente de Telegram por su teléfono verificado (ADR #40, D1).
 *
 * Nada entra al flujo de negocio (originación, pagos, asistente) hasta que el chat comparte SU
 * contacto. Con el teléfono vinculado, el mensaje se traduce al `InboundMessage` común (`from` =
 * teléfono) y el resto del sistema lo atiende igual que uno de WhatsApp: la misma persona por
 * ambos canales es el mismo solicitante/deudor.
 *
 * Devuelve el mensaje listo para enrutar, o `null` si el turno se consumió en la identificación.
 */
export class IdentifyTelegramSenderHandler {
  constructor(
    private readonly links: TelegramChatLinkStore,
    private readonly prompter: TelegramContactPrompter,
  ) {}

  async execute(input: {
    tenantId: string;
    channelId: string;
    inbound: TelegramInbound;
  }): Promise<InboundMessage | null> {
    const { tenantId, channelId, inbound } = input;
    const chat = { tenantId, channelId, chatId: inbound.chatId };

    if (inbound.type === "contact") {
      await this.linkContact(chat, inbound);
      return null;
    }

    const { phone } = await this.links.openChat(chat);
    if (!phone) {
      await this.prompter.requestContact(chat);
      return null;
    }
    if (inbound.type === "start") {
      await this.prompter.confirmIdentified(chat);
      return null;
    }
    return toInboundMessage(channelId, phone, inbound);
  }

  private async linkContact(
    chat: { tenantId: string; channelId: string; chatId: string },
    contact: TelegramContactInbound,
  ): Promise<void> {
    let phone: string;
    try {
      phone = verifiedPhoneOf(contact);
    } catch (error) {
      if (!(error instanceof TelegramContactRejectedError)) throw error;
      await this.prompter.rejectContact(chat, error.reason);
      return;
    }
    await this.links.linkPhone({ ...chat, phone });
    await this.prompter.confirmIdentified(chat);
  }
}

function toInboundMessage(
  channelId: string,
  phone: string,
  inbound: TelegramContentInbound,
): InboundMessage {
  return {
    ...inbound.content,
    id: telegramInboundMessageId(channelId, inbound.chatId, inbound.messageId),
    from: phone,
    channelId,
    receivedAt: inbound.receivedAt,
  } as InboundMessage;
}
