import { Module } from '@nestjs/common';
import { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
import { ChannelRoutingTextSender } from './channel-routing.text-sender';
import { ChannelRoutingMediaDownloader } from './channel-routing.media-downloader';

/**
 * Salida de mensajería agnóstica del proveedor (ADR #40): registra los drivers de cada proveedor y
 * exporta SOLO los routers, de modo que ningún módulo de negocio dependa de un proveedor concreto.
 */
@Module({
  providers: [
    WhatsappTextSender,
    WhatsappMediaDownloader,
    ChannelRoutingTextSender,
    ChannelRoutingMediaDownloader,
  ],
  exports: [ChannelRoutingTextSender, ChannelRoutingMediaDownloader],
})
export class MessagingModule {}
