import { ServiceUnavailableException } from '@nestjs/common';
import {
  RandomTelegramWebhookSecrets,
  TelegramWebhookEndpointConfig,
} from './telegram-webhook.config';

describe('TelegramWebhookEndpointConfig', () => {
  const original = process.env.PUBLIC_API_URL;
  afterEach(() => {
    process.env.PUBLIC_API_URL = original;
  });

  it('compone la URL del webhook del bot con su id opaco', () => {
    process.env.PUBLIC_API_URL = 'https://api.preztia.co/';

    expect(new TelegramWebhookEndpointConfig().urlFor('abc_123')).toBe(
      'https://api.preztia.co/webhooks/telegram/abc_123',
    );
  });

  it.each([undefined, '', 'http://api.preztia.co', 'localhost:3010'])(
    'se niega a registrar sin URL pública HTTPS (%p)',
    (value) => {
      if (value === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = value;

      expect(() => new TelegramWebhookEndpointConfig().urlFor('abc')).toThrow(
        ServiceUnavailableException,
      );
    },
  );
});

describe('RandomTelegramWebhookSecrets', () => {
  // Alfabeto que Telegram admite para `secret_token` (1–256 caracteres).
  const TELEGRAM_SECRET_ALPHABET = /^[A-Za-z0-9_-]{1,256}$/;
  const secrets = new RandomTelegramWebhookSecrets();

  it('genera id y secret válidos para Telegram y con 256 bits de entropía', () => {
    for (const value of [secrets.newHookId(), secrets.newSecretToken()]) {
      expect(value).toMatch(TELEGRAM_SECRET_ALPHABET);
      expect(Buffer.from(value, 'base64url')).toHaveLength(32);
    }
  });

  it('no repite valores', () => {
    const values = new Set(
      Array.from({ length: 50 }, () => secrets.newSecretToken()),
    );
    expect(values.size).toBe(50);
  });
});
