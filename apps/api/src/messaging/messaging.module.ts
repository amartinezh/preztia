import { Module } from '@nestjs/common';
import { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
import { TelegramBotApiClient } from '../telegram/telegram-bot-api.client';
import { TelegramChatLinkRepository } from '../telegram/telegram-chat-link.repository';
import { TelegramTextSender } from '../telegram/telegram-text-sender';
import { TelegramMediaDownloader } from '../telegram/telegram-media.downloader';
import { ChannelRoutingTextSender } from './channel-routing.text-sender';
import { ChannelRoutingMediaDownloader } from './channel-routing.media-downloader';

/**
 * Salida de mensajería agnóstica del proveedor (ADR #40): registra los drivers de cada proveedor
 * (WhatsApp y Telegram) y exporta los routers, de modo que ningún módulo de negocio dependa de un
 * proveedor concreto. Exporta además el cliente de la Bot API y los vínculos de chat, que el
 * módulo de Telegram reutiliza para la administración de bots y la entrada de mensajes.
 */
@Module({
  providers: [
    WhatsappTextSender,
    WhatsappMediaDownloader,
    TelegramBotApiClient,
    TelegramChatLinkRepository,
    TelegramTextSender,
    TelegramMediaDownloader,
    ChannelRoutingTextSender,
    ChannelRoutingMediaDownloader,
  ],
  exports: [
    ChannelRoutingTextSender,
    ChannelRoutingMediaDownloader,
    TelegramBotApiClient,
    TelegramChatLinkRepository,
  ],
})
export class MessagingModule {}
