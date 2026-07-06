import { Injectable, Logger } from '@nestjs/common';
import { fetchWithRetry } from '../../../shared/fetch-retry';

const DEFAULT_TIMEOUT_MS = 10000;

/** Resultado de probar una credencial; sin secretos ni PII. */
export interface CredentialCheck {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Cliente mínimo para PROBAR credenciales de PicPay: pide un token OAuth2 (client_credentials)
 * con el client_id/client_secret del tenant. Solo valida que el proveedor las acepte (200) —
 * el token obtenido se descarta y jamás se registra en logs. Cualquier fallo (red, 4xx/5xx) se
 * traduce a un `CredentialCheck` legible.
 */
@Injectable()
export class PicPayAuthClient {
  private readonly logger = new Logger('Cash:PicPayAuth');

  async verifyClientCredentials(input: {
    clientId: string;
    clientSecret: string;
  }): Promise<CredentialCheck> {
    const baseUrl =
      process.env.PICPAY_API_BASE_URL ?? 'https://checkout-api.picpay.com';
    const url = `${baseUrl}/oauth2/token`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: input.clientId,
          client_secret: input.clientSecret,
        }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true };
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, detail: 'Credenciales rechazadas por PicPay' };
      }
      return { ok: false, detail: 'PicPay no disponible' };
    } catch {
      // Nunca registrar client_secret; solo el hecho del fallo.
      this.logger.warn('Fallo verificando credenciales de PicPay');
      return { ok: false, detail: 'PicPay no disponible' };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function timeoutMs(): number {
  const n = Number(process.env.PICPAY_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}
