import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DownloadedMedia, MediaDownloader } from '@preztiaos/application';
import type { MediaRef } from '@preztiaos/domain';
import { resolveTelegramBotToken } from '../tenancy/unit-of-work';
import {
  TelegramApiError,
  TelegramBotApiClient,
} from './telegram-bot-api.client';

// La Bot API no entrega archivos de más de 20 MB (getFile falla con "file is too big").
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const GENERIC_MIME = 'application/octet-stream';
// Documento sin mime informado: se deduce de la extensión de la ruta en Telegram.
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

/**
 * Driver de Telegram del puerto `MediaDownloader` (ADR #40): `getFile` da la ruta temporal y luego
 * se descarga el binario, ambos con el token del bot del canal. El token va en la URL de la
 * descarga: el cliente de la Bot API jamás la registra ni la propaga en errores.
 */
@Injectable()
export class TelegramMediaDownloader implements MediaDownloader {
  constructor(private readonly api: TelegramBotApiClient) {}

  async download(media: MediaRef, channelId: string): Promise<DownloadedMedia> {
    const token = await resolveTelegramBotToken(channelId);
    if (!token) {
      throw new Error(
        `Canal ${channelId} sin bot configurado: no se puede descargar el archivo`,
      );
    }
    const file = await this.api.getFile(token, media.mediaId);
    if (file.fileSize !== null && file.fileSize > TELEGRAM_MAX_DOWNLOAD_BYTES) {
      throw new TelegramApiError('getFile', null, 'el archivo excede 20 MB');
    }
    const bytes = await this.api.downloadFile(
      token,
      file.filePath,
      TELEGRAM_MAX_DOWNLOAD_BYTES,
    );
    return {
      bytes,
      mimeType: resolveMime(media.mimeType, file.filePath),
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
}

function resolveMime(declared: string, filePath: string): string {
  if (declared !== GENERIC_MIME) return declared;
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? GENERIC_MIME;
}
