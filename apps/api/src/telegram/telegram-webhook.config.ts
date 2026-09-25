import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  TelegramWebhookEndpoint,
  TelegramWebhookSecrets,
} from '@preztiaos/application';

// Entropía del id de URL y del secret token: 32 bytes ⇒ 43 caracteres base64url, dentro del
// alfabeto que Telegram admite para `secret_token` ([A-Za-z0-9_-], 1–256).
const RANDOM_BYTES = 32;
const WEBHOOK_PATH = '/webhooks/telegram/';

/**
 * URL pública del webhook de cada bot: `PUBLIC_API_URL` + `/webhooks/telegram/<hookId>`. Telegram
 * exige HTTPS con certificado válido; sin URL pública configurada no se puede registrar ningún bot
 * (503 accionable para el operador, no un 500 opaco).
 */
@Injectable()
export class TelegramWebhookEndpointConfig implements TelegramWebhookEndpoint {
  urlFor(hookId: string): string {
    const base = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, '');
    if (!base?.startsWith('https://')) {
      throw new ServiceUnavailableException(
        'El servidor no tiene configurada su URL pública HTTPS (PUBLIC_API_URL): no se puede registrar el webhook de Telegram',
      );
    }
    return `${base}${WEBHOOK_PATH}${hookId}`;
  }
}

/** Material aleatorio del webhook con el CSPRNG de Node. */
@Injectable()
export class RandomTelegramWebhookSecrets implements TelegramWebhookSecrets {
  newHookId(): string {
    return randomBytes(RANDOM_BYTES).toString('base64url');
  }

  newSecretToken(): string {
    return randomBytes(RANDOM_BYTES).toString('base64url');
  }
}
