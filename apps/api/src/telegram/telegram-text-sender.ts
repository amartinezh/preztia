import { Injectable, Logger } from '@nestjs/common';
import type {
  OutboundRecipient,
  OutboundTextSender,
} from '@preztiaos/application';
import {
  resolveTelegramBotToken,
  resolveTenantByChannel,
} from '../tenancy/unit-of-work';
import {
  TelegramApiError,
  TelegramBotApiClient,
} from './telegram-bot-api.client';
import { TelegramChatLinkRepository } from './telegram-chat-link.repository';
import {
  splitForTelegram,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  whatsappMarkupToTelegramHtml,
} from './telegram-markup';

// Telegram mide el límite sobre el texto visible (sin etiquetas HTML); el margen cubre la
// diferencia entre el texto original y el visible tras la conversión.
const CHUNK_LIMIT = TELEGRAM_MAX_MESSAGE_LENGTH - 96;
const BLOCKED_BY_USER = 403;
const BAD_REQUEST = 400;
// Respuesta de la Bot API cuando el HTML no se pudo interpretar.
const UNPARSABLE_ENTITIES = /can't parse entities/i;

export type TelegramUnreachableReason = 'NO_BOT' | 'NOT_LINKED' | 'BLOCKED';

/**
 * El destinatario no se puede alcanzar por este bot: el canal no tiene bot, el teléfono nunca
 * compartió su contacto con él, o lo bloqueó. Es un error explícito: el mensaje NO se da por
 * enviado (el transcript no lo registra y el cobro/aviso puede intentar otro canal).
 */
export class TelegramRecipientUnreachableError extends Error {
  constructor(
    readonly reason: TelegramUnreachableReason,
    channelId: string,
  ) {
    super(
      `Destinatario no alcanzable por Telegram (${reason}) en canal ${channelId}`,
    );
    this.name = 'TelegramRecipientUnreachableError';
  }
}

/**
 * Driver de Telegram del puerto `OutboundTextSender` (ADR #40). El destinatario llega como
 * TELÉFONO, igual que en WhatsApp; aquí se traduce al chat vinculado con ese teléfono verificado.
 * El texto se convierte del marcado de WhatsApp a HTML de Telegram y se parte si excede el límite.
 */
@Injectable()
export class TelegramTextSender implements OutboundTextSender {
  private readonly logger = new Logger('Telegram:Send');

  constructor(
    private readonly api: TelegramBotApiClient,
    private readonly links: TelegramChatLinkRepository,
  ) {}

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    const { tenantId, token } = await this.resolveBot(to.channelId);
    const chat = await this.links.chatForPhone({
      tenantId,
      channelId: to.channelId,
      phone: to.recipient,
    });
    if (!chat)
      throw new TelegramRecipientUnreachableError('NOT_LINKED', to.channelId);
    if (chat.blocked)
      throw new TelegramRecipientUnreachableError('BLOCKED', to.channelId);

    const target = {
      tenantId,
      channelId: to.channelId,
      chatId: chat.chatId,
      token,
    };
    for (const chunk of splitForTelegram(body, CHUNK_LIMIT)) {
      await this.sendChunk(target, chunk);
    }
  }

  private async resolveBot(
    channelId: string,
  ): Promise<{ tenantId: string; token: string }> {
    const tenantId = await resolveTenantByChannel(channelId);
    const token = tenantId ? await resolveTelegramBotToken(channelId) : null;
    if (!tenantId || !token) {
      throw new TelegramRecipientUnreachableError('NO_BOT', channelId);
    }
    return { tenantId, token };
  }

  private async sendChunk(
    target: {
      tenantId: string;
      channelId: string;
      chatId: string;
      token: string;
    },
    chunk: string,
  ): Promise<void> {
    try {
      await this.api.sendMessage(target.token, {
        chatId: target.chatId,
        text: whatsappMarkupToTelegramHtml(chunk),
        parseMode: 'HTML',
      });
    } catch (error) {
      await this.recover(target, chunk, error);
    }
  }

  /** Degrada a texto plano si el HTML no se pudo interpretar; marca el bloqueo ante un 403. */
  private async recover(
    target: {
      tenantId: string;
      channelId: string;
      chatId: string;
      token: string;
    },
    chunk: string,
    error: unknown,
  ): Promise<void> {
    if (!(error instanceof TelegramApiError)) throw error;
    if (
      error.errorCode === BAD_REQUEST &&
      UNPARSABLE_ENTITIES.test(error.message)
    ) {
      this.logger.warn(
        `HTML rechazado en canal ${target.channelId}; se reenvía en texto plano`,
      );
      await this.api.sendMessage(target.token, {
        chatId: target.chatId,
        text: chunk,
      });
      return;
    }
    if (error.errorCode === BLOCKED_BY_USER) {
      await this.links.markBlocked(target);
      throw new TelegramRecipientUnreachableError('BLOCKED', target.channelId);
    }
    throw error;
  }
}
