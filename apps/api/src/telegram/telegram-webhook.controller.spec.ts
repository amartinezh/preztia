import { ForbiddenException } from '@nestjs/common';

// El módulo real abre Postgres al cargarse: se sustituye; aquí solo interesa qué bot resuelve.
jest.mock('../tenancy/unit-of-work', () => ({
  resolveTelegramWebhookTarget: jest.fn(),
}));

import type {
  IdentifyTelegramSenderHandler,
  ProcessInboundMessageHandler,
} from '@preztiaos/application';
import {
  DEFAULT_MESSAGING_CHANNELS,
  type InboundMessage,
  type MessagingChannelsSettings,
} from '@preztiaos/domain';
import type { ConversationFailureLog } from '../conversations/conversation-failure.log';
import type { MessagingChannelsRepository } from '../tenant-config/messaging-channels.repository';
import { resolveTelegramWebhookTarget } from '../tenancy/unit-of-work';
import { TelegramWebhookController } from './telegram-webhook.controller';

const resolveTarget = resolveTelegramWebhookTarget as jest.MockedFunction<
  typeof resolveTelegramWebhookTarget
>;

const HOOK_ID = 'a'.repeat(43);
const SECRET = 'secreto-del-bot';
const TARGET = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  channelId: 'tg:7012345678',
  secretToken: SECRET,
};
const TELEGRAM_ON: MessagingChannelsSettings = {
  ...DEFAULT_MESSAGING_CHANNELS,
  telegramEnabled: true,
};
const PHONE = '5561999998888';

function textUpdate(): unknown {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      chat: { id: 555, type: 'private' },
      from: { id: 555, is_bot: false },
      text: 'hola',
    },
  };
}

function contactUpdate(contactUserId: number): unknown {
  return {
    update_id: 2,
    message: {
      message_id: 43,
      date: 1_700_000_000,
      chat: { id: 555, type: 'private' },
      from: { id: 555, is_bot: false },
      contact: { phone_number: `+${PHONE}`, user_id: contactUserId },
    },
  };
}

function setup(settings: MessagingChannelsSettings = TELEGRAM_ON) {
  const identified: InboundMessage = {
    kind: 'text',
    body: 'hola',
    id: 'tg:7012345678:555:42',
    from: PHONE,
    channelId: TARGET.channelId,
    receivedAt: new Date(),
  };
  const identify = { execute: jest.fn().mockResolvedValue(identified) };
  const process = { execute: jest.fn().mockResolvedValue('console') };
  const failures = {
    record: jest.fn().mockResolvedValue(undefined),
    recordContactVerification: jest.fn().mockResolvedValue(undefined),
  };
  const messaging = { get: jest.fn().mockResolvedValue(settings) };
  const controller = new TelegramWebhookController(
    identify as unknown as IdentifyTelegramSenderHandler,
    process as unknown as ProcessInboundMessageHandler,
    failures as unknown as ConversationFailureLog,
    messaging as unknown as MessagingChannelsRepository,
  );
  return { controller, identify, process, failures, identified };
}

beforeEach(() => {
  resolveTarget.mockReset();
  resolveTarget.mockResolvedValue(TARGET);
});

describe('TelegramWebhookController — autenticidad (falla cerrado)', () => {
  it('rechaza un id de URL mal formado sin consultar la BD', async () => {
    const { controller } = setup();

    await expect(
      controller.receive('no-es-un-id', SECRET, textUpdate()),
    ).rejects.toThrow(ForbiddenException);
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it('rechaza un id que no corresponde a ningún bot', async () => {
    resolveTarget.mockResolvedValue(null);
    const { controller, identify } = setup();

    await expect(
      controller.receive(HOOK_ID, SECRET, textUpdate()),
    ).rejects.toThrow(ForbiddenException);
    expect(identify.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['sin header de secret', undefined],
    ['con secret distinto', 'otro-secreto'],
    ['con secret de otra longitud', 's'],
  ])('rechaza un update %s', async (_, secret) => {
    const { controller, identify, process } = setup();

    await expect(
      controller.receive(HOOK_ID, secret, textUpdate()),
    ).rejects.toThrow(ForbiddenException);
    expect(identify.execute).not.toHaveBeenCalled();
    expect(process.execute).not.toHaveBeenCalled();
  });
});

describe('TelegramWebhookController — atención', () => {
  it('identifica al remitente y enruta el mensaje al despachador común', async () => {
    const { controller, identify, process, identified } = setup();

    await expect(
      controller.receive(HOOK_ID, SECRET, textUpdate()),
    ).resolves.toEqual({
      received: true,
    });
    expect(identify.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TARGET.tenantId,
        channelId: TARGET.channelId,
      }),
    );
    expect(process.execute).toHaveBeenCalledWith(identified);
  });

  it('descarta (200) los updates si Telegram está deshabilitado en el tenant', async () => {
    const { controller, identify } = setup(DEFAULT_MESSAGING_CHANNELS);

    await expect(
      controller.receive(HOOK_ID, SECRET, textUpdate()),
    ).resolves.toEqual({
      received: true,
    });
    expect(identify.execute).not.toHaveBeenCalled();
  });

  it('ignora (200) un cuerpo que no es un Update', async () => {
    const { controller, identify } = setup();

    await expect(
      controller.receive(HOOK_ID, SECRET, { foo: 'bar' }),
    ).resolves.toEqual({
      received: true,
    });
    expect(identify.execute).not.toHaveBeenCalled();
  });

  it('no enruta nada si el turno se consumió en la identificación', async () => {
    const { controller, identify, process } = setup();
    identify.execute.mockResolvedValue(null);

    await controller.receive(HOOK_ID, SECRET, textUpdate());

    expect(process.execute).not.toHaveBeenCalled();
  });

  it('registra el fallo de procesamiento y aun así responde 200 (sin reentregas en bucle)', async () => {
    const { controller, process, failures, identified } = setup();
    const boom = new Error('IA caída');
    process.execute.mockRejectedValue(boom);

    await expect(
      controller.receive(HOOK_ID, SECRET, textUpdate()),
    ).resolves.toEqual({
      received: true,
    });
    expect(failures.record).toHaveBeenCalledWith(identified, boom);
  });

  it('atribuye al teléfono verificado el fallo técnico al vincular un contacto propio', async () => {
    const { controller, identify, failures } = setup();
    identify.execute.mockRejectedValue(new Error('BD caída'));

    await controller.receive(HOOK_ID, SECRET, contactUpdate(555));

    expect(failures.recordContactVerification).toHaveBeenCalledWith(
      {
        channelId: TARGET.channelId,
        applicantPhone: PHONE,
        messageId: 'tg:7012345678:555:43',
      },
      expect.any(Error),
    );
  });

  it('no atribuye a nadie el fallo con un contacto ajeno', async () => {
    const { controller, identify, failures } = setup();
    identify.execute.mockRejectedValue(new Error('BD caída'));

    await controller.receive(HOOK_ID, SECRET, contactUpdate(999));

    expect(failures.recordContactVerification).not.toHaveBeenCalled();
  });
});
