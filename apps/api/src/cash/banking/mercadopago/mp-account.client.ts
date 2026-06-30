import { Injectable, Logger } from '@nestjs/common';
import { fetchWithRetry } from '../../../shared/fetch-retry';

const DEFAULT_TIMEOUT_MS = 10000;

/** Resultado de probar una credencial; sin secretos ni PII. */
export interface CredentialCheck {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Cliente mínimo para PROBAR credenciales de Mercado Pago: `GET /users/me` con el access_token.
 * Solo valida que el token funcione (200) — no expone su valor ni el perfil. Cualquier fallo
 * (red, 4xx/5xx) se traduce a un `CredentialCheck` legible; el token nunca se escribe en logs.
 */
@Injectable()
export class MercadoPagoAccountClient {
  private readonly logger = new Logger('Cash:MercadoPagoAccount');

  async verifyAccessToken(accessToken: string): Promise<CredentialCheck> {
    const baseUrl =
      process.env.MP_API_BASE_URL ?? 'https://api.mercadopago.com';
    const url = `${baseUrl}/users/me`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const res = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        signal: controller.signal,
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          detail: 'Credenciales rechazadas por Mercado Pago',
        };
      }
      return { ok: false, detail: 'Mercado Pago no disponible' };
    } catch {
      // Nunca registrar el access_token; solo el hecho del fallo.
      this.logger.warn('Fallo verificando credenciales de Mercado Pago');
      return { ok: false, detail: 'Mercado Pago no disponible' };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function timeoutMs(): number {
  const n = Number(process.env.MP_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}
