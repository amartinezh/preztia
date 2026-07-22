import { ForbiddenException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';

// El módulo real abre una conexión a Postgres al cargarse (`createDb`), así que se sustituye
// por completo: aquí solo interesa qué credenciales resuelve el canal.
jest.mock('../tenancy/unit-of-work', () => ({
  resolveWhatsappCredentialsByPhone: jest.fn(),
  whatsappVerifyTokenHashExists: jest.fn(),
}));

import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { resolveWhatsappCredentialsByPhone } from '../tenancy/unit-of-work';

const resolveCreds = resolveWhatsappCredentialsByPhone as jest.MockedFunction<
  typeof resolveWhatsappCredentialsByPhone
>;

const PHONE_NUMBER_ID = '1234567890';
const APP_SECRET = 'app-secret-de-prueba';

function webhookBody(): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '5561999998888',
                phone_number_id: PHONE_NUMBER_ID,
              },
              messages: [
                {
                  from: '5561999997777',
                  id: 'wamid.TEST',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'hola' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function requestWith(body: unknown): RawBodyRequest<Request> {
  return {
    rawBody: Buffer.from(JSON.stringify(body)),
  } as RawBodyRequest<Request>;
}

function signatureFor(body: unknown, secret: string): string {
  return (
    'sha256=' +
    createHmac('sha256', secret)
      .update(Buffer.from(JSON.stringify(body)))
      .digest('hex')
  );
}

describe('WhatsappWebhookController · autenticidad del evento', () => {
  const process$ = { execute: jest.fn() };
  const controller = new WhatsappWebhookController(
    process$ as unknown as ConstructorParameters<
      typeof WhatsappWebhookController
    >[0],
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Regresión del hallazgo crítico de la auditoría: sin App Secret el webhook ACEPTABA el
  // evento, dejando la originación y los pagos abiertos a cualquiera en Internet.
  it('rechaza el evento si el canal no tiene App Secret', async () => {
    resolveCreds.mockResolvedValue({
      accessToken: 'token',
      appSecret: null,
      graphVersion: 'v21.0',
    });
    const body = webhookBody();

    await expect(
      controller.receive(body, undefined, requestWith(body)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(process$.execute).not.toHaveBeenCalled();
  });

  it('rechaza el evento si el número no corresponde a ningún canal', async () => {
    resolveCreds.mockResolvedValue(null);
    const body = webhookBody();

    await expect(
      controller.receive(body, undefined, requestWith(body)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(process$.execute).not.toHaveBeenCalled();
  });

  it('rechaza el evento si el cuerpo no trae phone_number_id', async () => {
    const body = { object: 'whatsapp_business_account', entry: [] };

    await expect(
      controller.receive(body, undefined, requestWith(body)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resolveCreds).not.toHaveBeenCalled();
    expect(process$.execute).not.toHaveBeenCalled();
  });

  it('rechaza el evento si la firma no coincide con el App Secret', async () => {
    resolveCreds.mockResolvedValue({
      accessToken: 'token',
      appSecret: APP_SECRET,
      graphVersion: 'v21.0',
    });
    const body = webhookBody();

    await expect(
      controller.receive(
        body,
        signatureFor(body, 'otro-secreto'),
        requestWith(body),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(process$.execute).not.toHaveBeenCalled();
  });

  it('procesa el mensaje cuando la firma es auténtica', async () => {
    resolveCreds.mockResolvedValue({
      accessToken: 'token',
      appSecret: APP_SECRET,
      graphVersion: 'v21.0',
    });
    const body = webhookBody();

    await expect(
      controller.receive(
        body,
        signatureFor(body, APP_SECRET),
        requestWith(body),
      ),
    ).resolves.toEqual({ received: true });
    expect(process$.execute).toHaveBeenCalledTimes(1);
  });
});
