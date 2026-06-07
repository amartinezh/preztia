import { InboundMessage, MediaRef } from "@preztiaos/domain";
import { WhatsappMessage, WhatsappWebhookEvent } from "@preztiaos/contracts";

/**
 * Adaptador de normalización: traduce el payload de WhatsApp Cloud API a la
 * unión discriminada del dominio. Los tipos de mensaje no soportados se omiten
 * (el webhook igualmente responde 200 para que Meta no reintente).
 */
export function toInboundMessages(event: WhatsappWebhookEvent): InboundMessage[] {
  const result: InboundMessage[] = [];

  for (const entry of event.entry) {
    for (const change of entry.changes) {
      const channelId = change.value.metadata.phone_number_id;
      for (const message of change.value.messages ?? []) {
        const normalized = normalize(message, channelId);
        if (normalized) result.push(normalized);
      }
    }
  }

  return result;
}

function normalize(message: WhatsappMessage, channelId: string): InboundMessage | null {
  const base = {
    id: message.id,
    from: message.from,
    channelId,
    receivedAt: new Date(Number(message.timestamp) * 1000),
  };

  switch (message.type) {
    case "text":
      return message.text ? { ...base, kind: "text", body: message.text.body } : null;

    case "audio":
      return message.audio
        ? { ...base, kind: "audio", media: toMediaRef(message.audio), voice: message.audio.voice ?? false }
        : null;

    case "image":
      return message.image
        ? {
            ...base,
            kind: "image",
            media: toMediaRef(message.image),
            ...(message.image.caption !== undefined ? { caption: message.image.caption } : {}),
          }
        : null;

    default:
      return null; // documentos, ubicaciones, stickers, etc.: aún no soportados
  }
}

function toMediaRef(media: { id: string; mime_type: string; sha256?: string }): MediaRef {
  return {
    mediaId: media.id,
    mimeType: media.mime_type,
    ...(media.sha256 !== undefined ? { sha256: media.sha256 } : {}),
  };
}
