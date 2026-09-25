// Los drivers reales importan `unit-of-work`, que abre Postgres al cargarse: aquí solo interesa
// a qué driver se despacha, así que el módulo se sustituye por completo.
jest.mock('../tenancy/unit-of-work', () => ({}));

import type { DownloadedMedia } from '@preztiaos/application';
import type { MediaRef } from '@preztiaos/domain';
import type { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import type { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
import type { TelegramTextSender } from '../telegram/telegram-text-sender';
import type { TelegramMediaDownloader } from '../telegram/telegram-media.downloader';
import { driverFor } from './channel-driver';
import { ChannelRoutingTextSender } from './channel-routing.text-sender';
import { ChannelRoutingMediaDownloader } from './channel-routing.media-downloader';

const WHATSAPP_CHANNEL = '1234567890';
const TELEGRAM_CHANNEL = 'tg:7012345678';
const MEDIA: MediaRef = { mediaId: 'media-1', mimeType: 'image/jpeg' };

describe('driverFor', () => {
  const drivers = { WHATSAPP: 'wa-driver' };

  it('elige el driver de WhatsApp para un phone_number_id sin prefijo', () => {
    expect(driverFor(drivers, WHATSAPP_CHANNEL)).toBe('wa-driver');
  });

  it('falla explícitamente si el proveedor del canal no tiene driver', () => {
    expect(() => driverFor(drivers, TELEGRAM_CHANNEL)).toThrow(
      /TELEGRAM sin integración/,
    );
  });

  it('falla rápido ante un canal mal formado', () => {
    expect(() => driverFor(drivers, 'tg:abc')).toThrow();
  });
});

function textDrivers() {
  const whatsapp = { sendText: jest.fn().mockResolvedValue(undefined) };
  const telegram = { sendText: jest.fn().mockResolvedValue(undefined) };
  const router = new ChannelRoutingTextSender(
    whatsapp as unknown as WhatsappTextSender,
    telegram as unknown as TelegramTextSender,
  );
  return { whatsapp, telegram, router };
}

function mediaDrivers(downloaded: DownloadedMedia) {
  const whatsapp = { download: jest.fn().mockResolvedValue(downloaded) };
  const telegram = { download: jest.fn().mockResolvedValue(downloaded) };
  const router = new ChannelRoutingMediaDownloader(
    whatsapp as unknown as WhatsappMediaDownloader,
    telegram as unknown as TelegramMediaDownloader,
  );
  return { whatsapp, telegram, router };
}

const DOWNLOADED: DownloadedMedia = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  sizeBytes: 3,
  sha256: 'abc',
};

describe('ChannelRoutingTextSender', () => {
  it('envía por WhatsApp un canal sin prefijo, con el mismo destinatario y cuerpo', async () => {
    const { whatsapp, telegram, router } = textDrivers();
    const to = { channelId: WHATSAPP_CHANNEL, recipient: '5561999997777' };

    await router.sendText(to, 'hola');

    expect(whatsapp.sendText).toHaveBeenCalledWith(to, 'hola');
    expect(telegram.sendText).not.toHaveBeenCalled();
  });

  it('envía por Telegram un canal tg:', async () => {
    const { whatsapp, telegram, router } = textDrivers();
    const to = { channelId: TELEGRAM_CHANNEL, recipient: '5561999997777' };

    await router.sendText(to, 'hola');

    expect(telegram.sendText).toHaveBeenCalledWith(to, 'hola');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('rechaza (como promesa) un canal mal formado sin tocar ningún driver', async () => {
    const { whatsapp, telegram, router } = textDrivers();

    await expect(
      router.sendText(
        { channelId: 'tg:abc', recipient: '5561999997777' },
        'hola',
      ),
    ).rejects.toThrow();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(telegram.sendText).not.toHaveBeenCalled();
  });
});

describe('ChannelRoutingMediaDownloader', () => {
  it('descarga con el driver de WhatsApp y devuelve su resultado', async () => {
    const { whatsapp, router } = mediaDrivers(DOWNLOADED);

    await expect(router.download(MEDIA, WHATSAPP_CHANNEL)).resolves.toBe(
      DOWNLOADED,
    );
    expect(whatsapp.download).toHaveBeenCalledWith(MEDIA, WHATSAPP_CHANNEL);
  });

  it('descarga con el driver de Telegram un canal tg:', async () => {
    const { whatsapp, telegram, router } = mediaDrivers(DOWNLOADED);

    await router.download(MEDIA, TELEGRAM_CHANNEL);

    expect(telegram.download).toHaveBeenCalledWith(MEDIA, TELEGRAM_CHANNEL);
    expect(whatsapp.download).not.toHaveBeenCalled();
  });
});
