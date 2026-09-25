import { Module } from '@nestjs/common';
import { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
import { TelegramBotApiClient } from '../telegram/telegram-bot-api.client';
import { TelegramChatLinkRepository } from '../telegram/telegram-chat-link.repository';
import { TelegramTextSender } from '../telegram/telegram-text-sender';
import { TelegramMediaDownloader } from '../telegram/telegram-media.downloader';
import { ChannelRoutingTextSender } from './channel-routing.text-sender';
import { ChannelRoutingMediaDownloader } from './channel-routing.media-downloader';
import { ReachableChannelResolver } from './reachable-channel.resolver';
import { ProactiveTextSender } from './proactive-text-sender';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';

/**
 * Salida de mensajería agnóstica del proveedor (ADR #40): registra los drivers de cada proveedor
 * (WhatsApp y Telegram) y exporta los routers, de modo que ningún módulo de negocio dependa de un
 * proveedor concreto, más el envío PROACTIVO que resuelve el canal alcanzable (D8). Exporta además
 * el cliente de la Bot API y los vínculos de chat, que el módulo de Telegram reutiliza para la
 * administración de bots y la entrada de mensajes.
 */
@Module({
  imports: [TenantConfigModule],
  providers: [
    WhatsappTextSender,
    WhatsappMediaDownloader,
    TelegramBotApiClient,
    TelegramChatLinkRepository,
    TelegramTextSender,
    TelegramMediaDownloader,
    ChannelRoutingTextSender,
    ChannelRoutingMediaDownloader,
    ReachableChannelResolver,
    // Avisos por iniciativa propia: resuelven el canal alcanzable antes de enviar.
    {
      provide: ProactiveTextSender,
      inject: [ReachableChannelResolver, ChannelRoutingTextSender],
      useFactory: (
        resolver: ReachableChannelResolver,
        router: ChannelRoutingTextSender,
      ) => new ProactiveTextSender(resolver, router),
    },
  ],
  exports: [
    ProactiveTextSender,
    ReachableChannelResolver,
    ChannelRoutingTextSender,
    ChannelRoutingMediaDownloader,
    TelegramBotApiClient,
    TelegramChatLinkRepository,
  ],
})
export class MessagingModule {}
