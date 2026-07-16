import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  normalizeAwesome,
  normalizeCoinGecko,
  normalizeSgs,
  normalizeTrm,
  type MarketIndicator,
} from './market-normalizers';

/** Lo que la landing consume: indicadores de mercado normalizados + marca de tiempo. */
export interface MarketSnapshot {
  readonly updatedAt: string | null;
  readonly indicators: readonly MarketIndicator[];
}

// Fuentes públicas y gratuitas (sin API key). Cada una falla de forma aislada.
const TRM_URL =
  'https://www.datos.gov.co/resource/32sa-8pi3.json?' +
  '%24select=valor%2Cvigenciadesde&%24order=vigenciadesde%20DESC&%24limit=30';
const AWESOME_URL =
  'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL';
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';

/** Series SGS del Banco Central de Brasil: id de serie + presentación del indicador. */
const SGS_SERIES: readonly { series: number; id: string; label: string }[] = [
  { series: 432, id: 'selic', label: 'Tasa SELIC' },
  { series: 4389, id: 'cdi', label: 'CDI' },
  { series: 13522, id: 'ipca12', label: 'IPCA 12 meses' },
];
const SGS_POINTS = 13;

function sgsUrl(series: number): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/${SGS_POINTS}?formato=json`;
}

/** Orden editorial de la cinta de indicadores en la landing. */
const INDICATOR_ORDER: readonly string[] = [
  'usd-cop',
  'usd-brl',
  'eur-brl',
  'btc-usd',
  'eth-usd',
  'selic',
  'cdi',
  'ipca12',
];

const FETCH_TIMEOUT_MS = toPositiveInt(
  process.env.MARKET_FETCH_TIMEOUT_MS,
  8000,
);

/**
 * Agregador de indicadores de mercado para la landing. Mantiene un snapshot EN MEMORIA que el
 * cron refresca y el controlador sirve. Resiliente por diseño: cada proveedor falla aislado
 * (`allSettled`) y un indicador que no llega conserva su ÚLTIMO valor bueno — la cinta nunca
 * queda a medias por un proveedor caído.
 */
@Injectable()
export class MarketService implements OnModuleInit {
  private readonly logger = new Logger('Market:Service');
  private readonly byId = new Map<string, MarketIndicator>();
  private updatedAt: string | null = null;

  onModuleInit(): void {
    // En pruebas no salimos a la red; en producción el primer refresco corre en segundo plano.
    if (process.env.NODE_ENV === 'test') return;
    void this.refresh();
  }

  getSnapshot(): MarketSnapshot {
    return { updatedAt: this.updatedAt, indicators: this.ordered() };
  }

  /** Recarga todos los proveedores; conserva el último valor bueno de lo que no llegue. */
  async refresh(): Promise<void> {
    const nowIso = new Date().toISOString();
    const results = await Promise.allSettled([
      this.loadJson(TRM_URL, 'TRM').then((json) => wrap(normalizeTrm(json))),
      this.loadJson(AWESOME_URL, 'AwesomeAPI').then(normalizeAwesome),
      this.loadJson(COINGECKO_URL, 'CoinGecko').then((json) =>
        normalizeCoinGecko(json, nowIso),
      ),
      ...SGS_SERIES.map((s) =>
        this.loadJson(sgsUrl(s.series), `SGS ${s.id}`).then((json) =>
          wrap(normalizeSgs(json, s.id, s.label)),
        ),
      ),
    ]);

    const fresh = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );
    if (fresh.length === 0) {
      this.logger.warn(
        'Ningún proveedor devolvió indicadores; se conserva el snapshot anterior',
      );
      return;
    }

    for (const indicator of fresh) this.byId.set(indicator.id, indicator);
    this.updatedAt = nowIso;
    this.logger.log(
      `Indicadores de mercado actualizados: ${fresh.length} frescos, ${this.byId.size} en snapshot`,
    );
  }

  private async loadJson(url: string, label: string): Promise<unknown> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: 'application/json',
          'user-agent': 'PreztiaOS-MarketBot/1.0',
        },
      });
      if (!res.ok) {
        this.logger.warn(`Proveedor "${label}" respondió ${res.status}`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.logger.warn(
        `Proveedor "${label}" no disponible: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private ordered(): MarketIndicator[] {
    return INDICATOR_ORDER.map((id) => this.byId.get(id)).filter(
      (i): i is MarketIndicator => i !== undefined,
    );
  }
}

function wrap(indicator: MarketIndicator | null): MarketIndicator[] {
  return indicator ? [indicator] : [];
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
