import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  type DownloadedMedia,
  type MediaDownloader,
} from '@preztiaos/application';
import { type MediaRef } from '@preztiaos/domain';

const DEFAULT_GRAPH_VERSION = 'v21.0';

interface MediaUrlResponse {
  url?: string;
  mime_type?: string;
}

/**
 * Adaptador del puerto MediaDownloader: descarga el binario de un media de WhatsApp.
 * La Graph API entrega el contenido en dos pasos: primero la URL temporal del media
 * (por su id) y luego el binario en esa URL (también autenticada con el token).
 */
@Injectable()
export class WhatsappMediaDownloader implements MediaDownloader {
  async download(media: MediaRef): Promise<DownloadedMedia> {
    const token = this.requireToken();
    const version = process.env.WHATSAPP_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION;

    const metaRes = await fetch(
      `https://graph.facebook.com/${version}/${media.mediaId}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!metaRes.ok) {
      throw new Error(
        `Graph API (media url) respondió ${metaRes.status}: ${await metaRes.text()}`,
      );
    }
    const meta = (await metaRes.json()) as MediaUrlResponse;
    if (!meta.url) throw new Error('Graph API no devolvió la URL del media');

    const binRes = await fetch(meta.url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!binRes.ok) {
      throw new Error(`Descarga de media respondió ${binRes.status}`);
    }

    const bytes = new Uint8Array(await binRes.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      bytes,
      mimeType: meta.mime_type ?? media.mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
    };
  }

  private requireToken(): string {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token)
      throw new Error(
        'WHATSAPP_ACCESS_TOKEN no configurado: no se puede descargar el media',
      );
    return token;
  }
}
