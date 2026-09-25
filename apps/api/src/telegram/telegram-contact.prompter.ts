import { Injectable } from '@nestjs/common';
import type { TelegramContactPrompter } from '@preztiaos/application';
import type { TelegramContactRejection } from '@preztiaos/domain';
import { resolveTelegramBotToken } from '../tenancy/unit-of-work';
import {
  TelegramBotApiClient,
  type TelegramReplyMarkup,
} from './telegram-bot-api.client';

const SHARE_CONTACT_BUTTON = '📱 Compartir mi número';

// Teclado de un solo botón nativo: Telegram envía el número VERIFICADO de la propia cuenta.
const SHARE_CONTACT_KEYBOARD: TelegramReplyMarkup = {
  keyboard: [[{ text: SHARE_CONTACT_BUTTON, request_contact: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
  input_field_placeholder: 'Toca el botón para compartir tu número',
};

const REQUEST_CONTACT_TEXT =
  '¡Hola! 👋 Para atenderte y proteger tu información necesitamos verificar tu número. ' +
  `Toca el botón «${SHARE_CONTACT_BUTTON}» que aparece abajo.`;

const IDENTIFIED_TEXT =
  '¡Listo! ✅ Ya verificamos tu número. Escríbenos en qué te podemos ayudar.';

const REJECTION_TEXT: Record<TelegramContactRejection, string> = {
  NOT_OWN_CONTACT:
    'Solo podemos verificar TU propio número. Por favor usa el botón ' +
    `«${SHARE_CONTACT_BUTTON}» en lugar de enviar un contacto guardado.`,
  INVALID_PHONE:
    'No pudimos leer tu número. Por favor inténtalo de nuevo con el botón ' +
    `«${SHARE_CONTACT_BUTTON}».`,
};

/**
 * Adaptador del puerto `TelegramContactPrompter`: redacta los mensajes de la verificación de
 * identidad y los envía con el teclado nativo de Telegram (presentación = infraestructura).
 * Estos mensajes NO van al transcript: antes de verificar no hay teléfono al que atribuirlos.
 */
@Injectable()
export class TelegramContactPrompterAdapter implements TelegramContactPrompter {
  constructor(private readonly api: TelegramBotApiClient) {}

  requestContact(chat: { channelId: string; chatId: string }): Promise<void> {
    return this.send(chat, REQUEST_CONTACT_TEXT, SHARE_CONTACT_KEYBOARD);
  }

  confirmIdentified(chat: {
    channelId: string;
    chatId: string;
  }): Promise<void> {
    return this.send(chat, IDENTIFIED_TEXT, { remove_keyboard: true });
  }

  rejectContact(
    chat: { channelId: string; chatId: string },
    reason: TelegramContactRejection,
  ): Promise<void> {
    return this.send(chat, REJECTION_TEXT[reason], SHARE_CONTACT_KEYBOARD);
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
      text,
      replyMarkup,
    });
  }
}
