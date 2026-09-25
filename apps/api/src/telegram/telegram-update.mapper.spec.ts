import type { TelegramUpdate } from '@preztiaos/contracts';
import { toTelegramInbound } from './telegram-update.mapper';

const CHAT_ID = 555001;
const DATE = 1_700_000_000;

function update(message: Record<string, unknown>): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      date: DATE,
      chat: { id: CHAT_ID, type: 'private' },
      from: { id: CHAT_ID, is_bot: false },
      ...message,
    },
  };
}

const base = {
  chatId: String(CHAT_ID),
  messageId: 42,
  receivedAt: new Date(DATE * 1000),
};

describe('toTelegramInbound', () => {
  it('normaliza un texto', () => {
    expect(toTelegramInbound(update({ text: 'hola' }))).toEqual({
      ...base,
      type: 'content',
      content: { kind: 'text', body: 'hola' },
    });
  });

  it.each(['/start', '/start campania-norte', '/start@preztia_bot'])(
    'reconoce el comando de inicio (%s)',
    (text) => {
      expect(toTelegramInbound(update({ text }))).toEqual({
        ...base,
        type: 'start',
      });
    },
  );

  it('no confunde un texto que empieza por /start con el comando', () => {
    expect(toTelegramInbound(update({ text: '/startup' }))?.type).toBe(
      'content',
    );
  });

  it('normaliza el contacto compartido con su user_id', () => {
    expect(
      toTelegramInbound(
        update({
          contact: { phone_number: '+5561999998888', user_id: CHAT_ID },
        }),
      ),
    ).toEqual({
      ...base,
      type: 'contact',
      senderUserId: String(CHAT_ID),
      contactUserId: String(CHAT_ID),
      phoneNumber: '+5561999998888',
    });
  });

  it('marca como sin dueño un contacto que no es cuenta de Telegram', () => {
    const inbound = toTelegramInbound(
      update({ contact: { phone_number: '+5561999998888' } }),
    );
    expect(inbound).toMatchObject({ type: 'contact', contactUserId: null });
  });

  it('toma la foto de mayor resolución, como JPEG, con su caption', () => {
    const inbound = toTelegramInbound(
      update({
        caption: 'cédula frente',
        photo: [
          { file_id: 'small', width: 90, height: 60 },
          { file_id: 'large', width: 1280, height: 853 },
          { file_id: 'medium', width: 320, height: 213 },
        ],
      }),
    );
    expect(inbound).toEqual({
      ...base,
      type: 'content',
      content: {
        kind: 'image',
        media: { mediaId: 'large', mimeType: 'image/jpeg' },
        caption: 'cédula frente',
      },
    });
  });

  it('normaliza un documento con su nombre y mime', () => {
    const inbound = toTelegramInbound(
      update({
        document: {
          file_id: 'doc-1',
          mime_type: 'application/pdf',
          file_name: 'rut.pdf',
        },
      }),
    );
    expect(inbound).toMatchObject({
      type: 'content',
      content: {
        kind: 'document',
        media: { mediaId: 'doc-1', mimeType: 'application/pdf' },
        filename: 'rut.pdf',
      },
    });
  });

  it('distingue nota de voz de archivo de audio', () => {
    expect(
      toTelegramInbound(
        update({ voice: { file_id: 'v', mime_type: 'audio/ogg' } }),
      ),
    ).toMatchObject({ content: { kind: 'audio', voice: true } });
    expect(
      toTelegramInbound(
        update({ audio: { file_id: 'a', mime_type: 'audio/mpeg' } }),
      ),
    ).toMatchObject({ content: { kind: 'audio', voice: false } });
  });

  it('normaliza la ubicación compartida', () => {
    expect(
      toTelegramInbound(
        update({ location: { latitude: -15.79, longitude: -47.88 } }),
      ),
    ).toMatchObject({
      content: { kind: 'location', latitude: -15.79, longitude: -47.88 },
    });
  });

  it.each([
    ['un grupo', { chat: { id: -100, type: 'group' }, text: 'hola' }],
    ['un canal', { chat: { id: -100, type: 'channel' }, text: 'hola' }],
    ['otro bot', { from: { id: 9, is_bot: true }, text: 'hola' }],
    ['un mensaje sin remitente', { from: undefined, text: 'hola' }],
    ['un sticker', { sticker: { file_id: 's' } }],
  ])('ignora %s', (_, message) => {
    expect(toTelegramInbound(update(message))).toBeNull();
  });

  it('ignora updates sin mensaje (ediciones, callbacks…)', () => {
    expect(toTelegramInbound({ update_id: 1 })).toBeNull();
  });
});
