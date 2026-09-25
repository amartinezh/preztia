import type { InboundContent, TelegramInbound } from '@preztiaos/application';
import type { TelegramMessage, TelegramUpdate } from '@preztiaos/contracts';

// Las fotos de Telegram llegan recomprimidas en JPEG y sin mime_type.
const PHOTO_MIME = 'image/jpeg';
// Documento sin mime informado: binario genérico (el enrutador de media decide por contenido).
const UNKNOWN_FILE_MIME = 'application/octet-stream';
// Comando de inicio del bot (con o sin payload de deep link: `/start abc`).
const START_COMMAND = /^\/start(?:@\w+)?(?:\s|$)/;
const MS_PER_SECOND = 1000;

/**
 * Adaptador de normalización: traduce el Update de la Bot API a la entrada de Telegram de la
 * aplicación. Devuelve `null` para lo que no se atiende: updates sin mensaje, chats que no son
 * privados (grupos/canales), mensajes de otros bots y tipos no soportados (stickers, video…).
 * Función pura: sin I/O.
 */
export function toTelegramInbound(
  update: TelegramUpdate,
): TelegramInbound | null {
  const message = update.message;
  if (!message || message.chat.type !== 'private') return null;
  if (!message.from || message.from.is_bot) return null;

  const base = {
    chatId: String(message.chat.id),
    messageId: message.message_id,
    receivedAt: new Date(message.date * MS_PER_SECOND),
  };

  if (message.contact) {
    return {
      ...base,
      type: 'contact',
      senderUserId: String(message.from.id),
      contactUserId:
        message.contact.user_id !== undefined
          ? String(message.contact.user_id)
          : null,
      phoneNumber: message.contact.phone_number,
    };
  }
  if (message.text !== undefined && START_COMMAND.test(message.text)) {
    return { ...base, type: 'start' };
  }
  const content = toContent(message);
  return content ? { ...base, type: 'content', content } : null;
}

function toContent(message: TelegramMessage): InboundContent | null {
  if (message.text !== undefined) return { kind: 'text', body: message.text };

  const caption =
    message.caption !== undefined ? { caption: message.caption } : {};
  const largestPhoto = largest(message.photo);
  if (largestPhoto) {
    return {
      kind: 'image',
      media: { mediaId: largestPhoto.file_id, mimeType: PHOTO_MIME },
      ...caption,
    };
  }
  if (message.document) {
    return {
      kind: 'document',
      media: {
        mediaId: message.document.file_id,
        mimeType: message.document.mime_type ?? UNKNOWN_FILE_MIME,
      },
      ...(message.document.file_name !== undefined
        ? { filename: message.document.file_name }
        : {}),
    };
  }
  const audio = message.voice ?? message.audio;
  if (audio) {
    return {
      kind: 'audio',
      media: {
        mediaId: audio.file_id,
        mimeType: audio.mime_type ?? UNKNOWN_FILE_MIME,
      },
      voice: message.voice !== undefined,
    };
  }
  if (message.location) {
    return {
      kind: 'location',
      latitude: message.location.latitude,
      longitude: message.location.longitude,
    };
  }
  return null;
}

/** Tamaño de mayor resolución de una foto (Telegram envía varias escalas). */
function largest(
  sizes: TelegramMessage['photo'],
): NonNullable<TelegramMessage['photo']>[number] | null {
  if (!sizes?.length) return null;
  return sizes.reduce((best, size) =>
    size.width * size.height > best.width * best.height ? size : best,
  );
}
