import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../../shared/fetch-retry';

const DEFAULT_TIMEOUT_MS = 10000;

/** Respuesta cruda de la consulta de un PIX recibido en el Banco Inter. */
export interface InterPixQueryResponse {
  readonly found: boolean;
  readonly status: number;
  readonly body: unknown;
}

/**
 * Cliente HTTP del API del Banco Inter (BR).
 *
 * La autenticación está encapsulada aquí como un detalle del adaptador: hoy es
 * una API key directa (la suministrada por tenant en `tenant_bank_account`);
 * cuando se migre al esquema real de Inter (OAuth2 client_credentials + mTLS),
 * solo cambia este cliente — el puerto BankPaymentVerifier no se entera.
 */
@Injectable()
export class InterApiClient {
  /** Consulta un PIX recibido por su identificador end-to-end (e2eid). */
  async queryReceivedPix(input: { endToEndId: string; apiKey: string }): Promise<InterPixQueryResponse> {
    const baseUrl = process.env.INTER_API_BASE_URL ?? 'https://cdpj.partners.bancointer.com.br';
    const url = `${baseUrl}/pix/v2/pix/${encodeURIComponent(input.endToEndId)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const res = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json',
        },
        signal: controller.signal,
      });

      if (res.status === 404) return { found: false, status: res.status, body: null };
      if (!res.ok) {
        throw new Error(`Inter API respondió ${res.status}`);
      }
      return { found: true, status: res.status, body: await res.json() };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function timeoutMs(): number {
  const n = Number(process.env.INTER_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}
