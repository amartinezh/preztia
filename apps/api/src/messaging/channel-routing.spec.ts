// Los drivers reales importan `unit-of-work`, que abre Postgres al cargarse: aquí solo interesa
// a qué driver se despacha, así que el módulo se sustituye por completo.
jest.mock('../tenancy/unit-of-work', () => ({}));

import type { DownloadedMedia } from '@preztiaos/application';
import type { MediaRef } from '@preztiaos/domain';
import type { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import type { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
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

describe('ChannelRoutingTextSender', () => {
  it('delega en el driver de WhatsApp con el mismo destinatario y cuerpo', async () => {
    const sendText = jest.fn().mockResolvedValue(undefined);
    const router = new ChannelRoutingTextSender({
      sendText,
    } as unknown as WhatsappTextSender);

    const to = { channelId: WHATSAPP_CHANNEL, recipient: '5561999997777' };
    await router.sendText(to, 'hola');

    expect(sendText).toHaveBeenCalledWith(to, 'hola');
  });

  it('no da por enviado un mensaje a un canal sin integración', async () => {
    const sendText = jest.fn();
    const router = new ChannelRoutingTextSender({
      sendText,
    } as unknown as WhatsappTextSender);

    await expect(
      router.sendText(
        { channelId: TELEGRAM_CHANNEL, recipient: '5561999997777' },
        'hola',
      ),
    ).rejects.toThrow(/sin integración/);
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe('ChannelRoutingMediaDownloader', () => {
  it('descarga con el driver de WhatsApp y devuelve su resultado', async () => {
    const downloaded: DownloadedMedia = {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      sizeBytes: 3,
      sha256: 'abc',
    };
    const download = jest.fn().mockResolvedValue(downloaded);
    const router = new ChannelRoutingMediaDownloader({
      download,
    } as unknown as WhatsappMediaDownloader);

    await expect(router.download(MEDIA, WHATSAPP_CHANNEL)).resolves.toBe(
      downloaded,
    );
    expect(download).toHaveBeenCalledWith(MEDIA, WHATSAPP_CHANNEL);
  });

  it('rechaza la descarga de un canal sin integración', async () => {
    const download = jest.fn();
    const router = new ChannelRoutingMediaDownloader({
      download,
    } as unknown as WhatsappMediaDownloader);

    await expect(router.download(MEDIA, TELEGRAM_CHANNEL)).rejects.toThrow(
      /sin integración/,
    );
    expect(download).not.toHaveBeenCalled();
  });
});
