jest.mock('../tenancy/unit-of-work', () => ({
  resolveTenantByChannel: jest.fn(),
  resolveTelegramBotToken: jest.fn(),
}));

import {
  resolveTelegramBotToken,
  resolveTenantByChannel,
} from '../tenancy/unit-of-work';
import {
  TelegramApiError,
  type TelegramBotApiClient,
} from './telegram-bot-api.client';
import type { TelegramChatLinkRepository } from './telegram-chat-link.repository';
import {
  TelegramRecipientUnreachableError,
  TelegramTextSender,
} from './telegram-text-sender';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CHANNEL = 'tg:7012345678';
const TOKEN = '7012345678:AAH-token';
const PHONE = '5561999998888';
const CHAT = '555001';
const TO = { channelId: CHANNEL, recipient: PHONE };

const tenantOf = resolveTenantByChannel as jest.MockedFunction<
  typeof resolveTenantByChannel
>;
const tokenOf = resolveTelegramBotToken as jest.MockedFunction<
  typeof resolveTelegramBotToken
>;

function setup(
  chat: { chatId: string; blocked: boolean } | null = {
    chatId: CHAT,
    blocked: false,
  },
) {
  const api = { sendMessage: jest.fn().mockResolvedValue(undefined) };
  const links = {
    chatForPhone: jest.fn().mockResolvedValue(chat),
    markBlocked: jest.fn().mockResolvedValue(undefined),
  };
  const sender = new TelegramTextSender(
    api as unknown as TelegramBotApiClient,
    links as unknown as TelegramChatLinkRepository,
  );
  return { api, links, sender };
}

async function unreachableReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TelegramRecipientUnreachableError) return error.reason;
    throw error;
  }
  throw new Error('se esperaba un destinatario inalcanzable');
}

beforeEach(() => {
  tenantOf.mockReset().mockResolvedValue(TENANT);
  tokenOf.mockReset().mockResolvedValue(TOKEN);
});

describe('TelegramTextSender', () => {
  it('envía al chat vinculado al teléfono, con el marcado traducido a HTML', async () => {
    const { api, links, sender } = setup();

    await sender.sendText(TO, 'Tu cuota es *$50.000* & vence hoy');

    expect(links.chatForPhone).toHaveBeenCalledWith({
      tenantId: TENANT,
      channelId: CHANNEL,
      phone: PHONE,
    });
    expect(api.sendMessage).toHaveBeenCalledWith(TOKEN, {
      chatId: CHAT,
      text: 'Tu cuota es <b>$50.000</b> &amp; vence hoy',
      parseMode: 'HTML',
    });
  });

  it('parte un texto que excede el límite de Telegram en varios mensajes, en orden', async () => {
    const { api, sender } = setup();
    const paragraph = 'x'.repeat(3000);

    await sender.sendText(TO, `${paragraph}\n\n${paragraph}`);

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('no da por enviado un mensaje a un teléfono que nunca vinculó el bot', async () => {
    const { api, sender } = setup(null);

    await expect(unreachableReason(sender.sendText(TO, 'hola'))).resolves.toBe(
      'NOT_LINKED',
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('no escribe a quien bloqueó el bot', async () => {
    const { api, sender } = setup({ chatId: CHAT, blocked: true });

    await expect(unreachableReason(sender.sendText(TO, 'hola'))).resolves.toBe(
      'BLOCKED',
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('marca el bloqueo cuando Telegram responde 403', async () => {
    const { api, links, sender } = setup();
    api.sendMessage.mockRejectedValue(
      new TelegramApiError(
        'sendMessage',
        403,
        'Forbidden: bot was blocked by the user',
      ),
    );

    await expect(unreachableReason(sender.sendText(TO, 'hola'))).resolves.toBe(
      'BLOCKED',
    );
    expect(links.markBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        channelId: CHANNEL,
        chatId: CHAT,
      }),
    );
  });

  it('reenvía en texto plano si Telegram no pudo interpretar el HTML', async () => {
    const { api, sender } = setup();
    api.sendMessage
      .mockRejectedValueOnce(
        new TelegramApiError(
          'sendMessage',
          400,
          "Bad Request: can't parse entities",
        ),
      )
      .mockResolvedValueOnce(undefined);

    await sender.sendText(TO, 'hola *raro');

    expect(api.sendMessage).toHaveBeenLastCalledWith(TOKEN, {
      chatId: CHAT,
      text: 'hola *raro',
    });
  });

  it('propaga cualquier otro fallo de Telegram', async () => {
    const { api, sender } = setup();
    api.sendMessage.mockRejectedValue(
      new TelegramApiError('sendMessage', 500, 'Internal'),
    );

    await expect(sender.sendText(TO, 'hola')).rejects.toThrow(TelegramApiError);
  });

  it('falla explícitamente si el canal no tiene bot', async () => {
    tokenOf.mockResolvedValue(null);
    const { sender } = setup();

    await expect(unreachableReason(sender.sendText(TO, 'hola'))).resolves.toBe(
      'NO_BOT',
    );
  });
});
