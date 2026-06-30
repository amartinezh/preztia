import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { type BankReportConfig } from '@preztiaos/contracts';
import { fetchWithRetry } from '../../../shared/fetch-retry';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_POLL_ATTEMPTS = 8;
const DEFAULT_POLL_DELAY_MS = 3000;

// report_translation FIJADO en inglés: así los encabezados del CSV son los de
// SETTLEMENT_COLUMNS_EN y el parser no depende de la preferencia de visualización del tenant.
const FIXED_REPORT_TRANSLATION = 'en';
const REQUIRED_COLUMNS = [
  'SOURCE_ID',
  'TRANSACTION_AMOUNT',
  'SETTLEMENT_NET_AMOUNT',
  'TRANSACTION_CURRENCY',
  'PAYMENT_METHOD_TYPE',
  'TRANSACTION_TYPE',
  'SETTLEMENT_DATE',
] as const;

export interface FetchSettlementInput {
  readonly accessToken: string;
  /** Ventana del reporte (ISO/UTC). */
  readonly begin: string;
  readonly end: string;
  readonly reportConfig: BankReportConfig | null;
}

/** Puerto interno: traer el CSV del settlement_report (permite mockear el HTTP en el adaptador). */
export interface SettlementReportFetcher {
  fetchSettlementCsv(input: FetchSettlementInput): Promise<string | null>;
}

// Forma (parcial, defensiva) de un ítem del listado de reportes. Campos exactos pendientes de
// confirmar contra un reporte productivo real (ver VALIDATION_MERCADOPAGO_PIX.md).
const reportListSchema = z.object({
  status: z.string().optional(),
  file_name: z.string().optional(),
  date_created: z.string().optional(),
  generation_date: z.string().optional(),
});

/**
 * Cliente HTTP del settlement_report de Mercado Pago. Ciclo: configura columnas/idioma →
 * crea el reporte (202, asíncrono) → consulta el listado hasta que esté `processed` → descarga
 * el CSV. Defensivo: cualquier fallo devuelve `null` (la conciliación queda sin confirmar, nunca
 * rompe). NUNCA registra el access_token. La forma exacta de las respuestas queda pendiente de
 * verificar contra un reporte productivo real.
 */
@Injectable()
export class MercadoPagoReportClient implements SettlementReportFetcher {
  private readonly logger = new Logger('Payments:MercadoPagoReport');

  async fetchSettlementCsv(
    input: FetchSettlementInput,
  ): Promise<string | null> {
    try {
      await this.ensureConfig(input.accessToken);
      const created = await this.createReport(input);
      if (!created) return null;
      const fileName = await this.pollForFile(input.accessToken);
      if (!fileName) {
        this.logger.warn(
          'El settlement_report no quedó listo en la ventana de espera',
        );
        return null;
      }
      return await this.downloadReport(input.accessToken, fileName);
    } catch (err) {
      this.logger.error(
        'Fallo trayendo el settlement_report de Mercado Pago',
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  /** Fija columnas e idioma del reporte. Best-effort: si falla, se intenta generar igual. */
  private async ensureConfig(accessToken: string): Promise<void> {
    const url = `${baseUrl()}/v1/account/settlement_report/config`;
    const body = JSON.stringify({
      columns: REQUIRED_COLUMNS.map((key) => ({ key })),
      report_translation: FIXED_REPORT_TRANSLATION,
    });
    // POST crea la config la primera vez (201); si ya existe, se actualiza con PUT.
    const post = await this.send(url, accessToken, 'POST', body);
    if (post && !post.ok) {
      await this.send(url, accessToken, 'PUT', body);
    }
  }

  /** Dispara la generación del reporte de la ventana (respuesta 202 asíncrona). */
  private async createReport(input: FetchSettlementInput): Promise<boolean> {
    const url = `${baseUrl()}/v1/account/settlement_report`;
    const body = JSON.stringify({
      begin_date: input.begin,
      end_date: input.end,
    });
    const res = await this.send(url, input.accessToken, 'POST', body);
    return Boolean(res?.ok);
  }

  /** Consulta el listado hasta encontrar un reporte `processed`; devuelve su file_name. */
  private async pollForFile(accessToken: string): Promise<string | null> {
    const url = `${baseUrl()}/v1/account/settlement_report/list`;
    for (let attempt = 0; attempt < pollAttempts(); attempt++) {
      const res = await this.send(url, accessToken, 'GET');
      if (res?.ok) {
        const fileName = pickProcessedFile(res.body);
        if (fileName) return fileName;
      }
      await sleep(pollDelayMs());
    }
    return null;
  }

  private async downloadReport(
    accessToken: string,
    fileName: string,
  ): Promise<string | null> {
    const url = `${baseUrl()}/v1/account/settlement_report/${encodeURIComponent(fileName)}`;
    const res = await this.send(url, accessToken, 'GET', undefined, 'text');
    return res?.ok && typeof res.text === 'string' ? res.text : null;
  }

  private async send(
    url: string,
    accessToken: string,
    method: 'GET' | 'POST' | 'PUT',
    body?: string,
    as: 'json' | 'text' = 'json',
  ): Promise<{
    ok: boolean;
    status: number;
    body?: unknown;
    text?: string;
  } | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const res = await fetchWithRetry(url, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        ...(body ? { body } : {}),
        signal: controller.signal,
      });
      if (as === 'text') {
        return { ok: res.ok, status: res.status, text: await res.text() };
      }
      const json: unknown = res.ok ? await res.json().catch(() => null) : null;
      return { ok: res.ok, status: res.status, body: json };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Elige el file_name de un reporte `processed` del listado (defensivo ante formas variables). */
function pickProcessedFile(body: unknown): string | null {
  const items = Array.isArray(body) ? body : [];
  const processed = items
    .map((item) => reportListSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter(
      (item) =>
        item.file_name && (item.status ?? '').toLowerCase() === 'processed',
    )
    .sort((a, b) => order(b) - order(a));
  return processed[0]?.file_name ?? null;
}

function order(item: {
  date_created?: string;
  generation_date?: string;
}): number {
  const raw = item.generation_date ?? item.date_created ?? '';
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(): string {
  return process.env.MP_API_BASE_URL ?? 'https://api.mercadopago.com';
}

function timeoutMs(): number {
  const n = Number(process.env.MP_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function pollAttempts(): number {
  const n = Number(process.env.MP_REPORT_POLL_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_ATTEMPTS;
}

function pollDelayMs(): number {
  const n = Number(process.env.MP_REPORT_POLL_DELAY_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_DELAY_MS;
}
