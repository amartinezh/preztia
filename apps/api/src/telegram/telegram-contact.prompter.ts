import { Injectable } from '@nestjs/common';
import type { TelegramContactPrompter } from '@preztiaos/application';
import {
  clientMessagesFor,
  type TelegramContactRejection,
  type TelegramMessages,
} from '@preztiaos/domain';
import { ClientLanguageRepository } from '../tenant-config/client-language.repository';
import { resolveTelegramBotToken } from '../tenancy/unit-of-work';
import {
  TelegramBotApiClient,
  type TelegramReplyMarkup,
} from './telegram-bot-api.client';
import { whatsappMarkupToTelegramHtml } from './telegram-markup';

// Teclado de un solo botón nativo: Telegram envía el número VERIFICADO de la propia cuenta.
function shareContactKeyboard(m: TelegramMessages): TelegramReplyMarkup {
  return {
    keyboard: [[{ text: m.shareContactButton, request_contact: true }]],
    one_time_keyboard: true,
    resize_keyboard: true,
    input_field_placeholder: m.shareContactPlaceholder,
  };
}

// Telegram recomprime las FOTOS; por eso el mensaje de identificado sugiere enviarlas como ARCHIVO
// (llegan con la calidad original y mejora la lectura de documentos y comprobantes).

/**
 * Adaptador del puerto `TelegramContactPrompter`: redacta los mensajes de la verificación de
 * identidad y los envía con el teclado nativo de Telegram (presentación = infraestructura).
 * Estos mensajes NO van al transcript: antes de verificar no hay teléfono al que atribuirlos. Salen
 * en el idioma vigente del tenant dueño del bot.
 */
@Injectable()
export class TelegramContactPrompterAdapter implements TelegramContactPrompter {
  constructor(
    private readonly api: TelegramBotApiClient,
    private readonly languages: ClientLanguageRepository,
  ) {}

  async requestContact(chat: {
    channelId: string;
    chatId: string;
  }): Promise<void> {
    const m = await this.messagesFor(chat.channelId);
    await this.send(chat, m.requestContact, shareContactKeyboard(m));
  }

  async confirmIdentified(chat: {
    channelId: string;
    chatId: string;
  }): Promise<void> {
    const m = await this.messagesFor(chat.channelId);
    await this.send(chat, m.identified, { remove_keyboard: true });
  }

  async rejectContact(
    chat: { channelId: string; chatId: string },
    reason: TelegramContactRejection,
  ): Promise<void> {
    const m = await this.messagesFor(chat.channelId);
    await this.send(chat, m.rejection[reason], shareContactKeyboard(m));
  }

  private async messagesFor(channelId: string): Promise<TelegramMessages> {
    return clientMessagesFor(await this.languages.byChannel(channelId))
      .telegram;
  }

  private async send(
    chat: { channelId: string; chatId: string },
    text: string,
    replyMarkup: TelegramReplyMarkup,
  ): Promise<void> {
    const token = await resolveTelegramBotToken(chat.channelId);
    if (!token) {
      throw new Error(`Canal ${chat.channelId} sin bot configurado`);
    }
    await this.api.sendMessage(token, {
      chatId: chat.chatId,
      // Mismo formato que el resto de mensajes del canal (marcado ligero → HTML escapado).
      text: whatsappMarkupToTelegramHtml(text),
      parseMode: 'HTML',
      replyMarkup,
    });
  }
}
