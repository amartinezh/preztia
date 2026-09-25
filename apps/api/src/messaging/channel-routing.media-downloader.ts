import { Injectable } from '@nestjs/common';
import type { DownloadedMedia, MediaDownloader } from '@preztiaos/application';
import type { MediaRef } from '@preztiaos/domain';
import { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
import { driverFor, type ChannelDrivers } from './channel-driver';

/**
 * Implementación del puerto `MediaDownloader` que descarga con el driver del proveedor del canal
 * (WhatsApp o Telegram, ADR #40).
 */
@Injectable()
export class ChannelRoutingMediaDownloader implements MediaDownloader {
  private readonly drivers: ChannelDrivers<MediaDownloader>;

  constructor(whatsapp: WhatsappMediaDownloader) {
    this.drivers = { WHATSAPP: whatsapp };
  }

  async download(media: MediaRef, channelId: string): Promise<DownloadedMedia> {
    return driverFor(this.drivers, channelId).download(media, channelId);
  }
}
