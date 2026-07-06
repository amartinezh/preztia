import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ChargeGateway, CreatedCharge } from '@preztiaos/application';
import { fetchWithRetry } from '../../../shared/fetch-retry';
import { PicPayChargeContextReader } from './picpay-charge-context.reader';

const DEFAULT_TIMEOUT_MS = 10000;
const SECONDS_PER_MINUTE = 60;

/**
 * Adaptador `ChargeGateway` de PicPay: genera una cobrança PIX (`POST /charge/pix`) con el monto
 * elegido por el cliente y devuelve el "copia e cola". Autentica con OAuth2 (client_credentials)
 * usando las credenciales cifradas del tenant. Cualquier fallo (credenciales, red, 4xx/5xx) se
 * traduce en una excepción para que el caso de uso degrade con elegancia; los secretos y la PII del
 * pagador NUNCA se escriben en logs.
 *
 * NOTA: la forma EXACTA del request/response puede variar por versión del producto PicPay; se
 * valida contra una cuenta real al activar el primer tenant. El parser es defensivo ante variantes.
 */
@Injectable()
export class PicPayChargeClient implements ChargeGateway {
  private readonly logger = new Logger('Payments:PicPayCharge');

  constructor(private readonly context: PicPayChargeContextReader) {}

  async createCharge(input: {
    tenantId: string;
    creditId: string;
    amountMinor: number;
    currency: string;
    payerPhone: string;
    expiresInMinutes: number;
  }): Promise<CreatedCharge> {
    const ctx = await this.context.read({
      tenantId: input.tenantId,
      creditId: input.creditId,
    });
    if (!ctx) {
      throw new Error('PicPay no está configurado para generar la cobrança');
    }

    const token = await this.fetchToken(ctx.clientId, ctx.clientSecret);
    const merchantChargeId = randomUUID();

    const body = {
      paymentSource: 'CHECKOUT',
      merchantChargeId,
      customer: {
        name: ctx.customer.name,
        documentType: ctx.customer.document.length > 11 ? 'CNPJ' : 'CPF',
        document: ctx.customer.document,
      },
      transactions: [
        {
          paymentType: 'PIX',
          amount: input.amountMinor,
          pix: { expiration: input.expiresInMinutes * SECONDS_PER_MINUTE },
        },
      ],
    };

    const res = await this.post('/charge/pix', token, body);
    if (!res.ok) {
      throw new Error(`PicPay /charge/pix respondió ${res.status}`);
    }
    const json = (await res.json()) as unknown;
    const copyPaste = extractCopyPaste(json);
    if (!copyPaste) {
      throw new Error('PicPay no devolvió el código PIX de la cobrança');
    }
    return {
      merchantChargeId,
      copyPaste,
      expiresAt: computeExpiresAt(input.expiresInMinutes),
    };
  }

  /** Token OAuth2 (client_credentials); vida de ~5 min, se pide por cobrança. */
  private async fetchToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const res = await this.post('/oauth2/token', null, {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (!res.ok) {
      throw new Error(`PicPay /oauth2/token respondió ${res.status}`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('PicPay no devolvió access_token');
    return json.access_token;
  }

  private async post(
    path: string,
    token: string | null,
    body: unknown,
  ): Promise<Response> {
    const baseUrl =
      process.env.PICPAY_API_BASE_URL ?? 'https://checkout-api.picpay.com';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs());
    try {
      return await fetchWithRetry(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Extrae el código copia-e-cola del response, defensivo ante variantes de forma. */
function extractCopyPaste(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const transactions = Array.isArray(root.transactions)
    ? (root.transactions as Record<string, unknown>[])
    : [];
  for (const tx of transactions) {
    const pix = tx.pix as Record<string, unknown> | undefined;
    const code = pix?.qrCode ?? pix?.copyPaste ?? pix?.emv;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return null;
}

function computeExpiresAt(minutes: number): string {
  return new Date(
    Date.now() + minutes * SECONDS_PER_MINUTE * 1000,
  ).toISOString();
}

function timeoutMs(): number {
  const n = Number(process.env.PICPAY_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}
