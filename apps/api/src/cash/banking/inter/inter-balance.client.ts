import { Injectable } from '@nestjs/common';
import { fetchWithRetry } from '../../../shared/fetch-retry';

const DEFAULT_TIMEOUT_MS = 10000;

/** Respuesta cruda de la consulta de saldo de la cuenta en el Banco Inter. */
export interface InterBalanceResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

/**
 * Cliente HTTP del saldo de cuenta del Banco Inter (BR). La autenticación (hoy API key
 * suministrada por tenant en `tenant_bank_account`) se encapsula aquí: si migra a OAuth2 +
 * mTLS, solo cambia este cliente — el puerto BankBalanceProvider no se entera.
 */
@Injectable()
export class InterBalanceClient {
  async queryBalance(input: { apiKey: string }): Promise<InterBalanceResponse> {
    const baseUrl =
      process.env.INTER_API_BASE_URL ??
      'https://cdpj.partners.bancointer.com.br';
    const url = `${baseUrl}/banking/v2/saldo`;

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
      if (!res.ok) return { ok: false, status: res.status, body: null };
      return { ok: true, status: res.status, body: await res.json() };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function timeoutMs(): number {
  const n = Number(process.env.INTER_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}
