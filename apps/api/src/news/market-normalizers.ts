/**
 * Normalizadores PUROS de indicadores de mercado (sin I/O, sin framework, sin dependencias):
 * reciben el JSON crudo de cada proveedor público y devuelven indicadores normalizados para la
 * landing. Viven junto al módulo (como `rss-parser`) porque son utilidades de infraestructura,
 * no reglas del dominio de préstamos.
 *
 * Proveedores cubiertos (todos gratuitos y sin API key):
 *  - datos.gov.co (Socrata)  → TRM oficial USD/COP con histórico (sparkline)
 *  - AwesomeAPI              → cotizaciones de divisas (USD/BRL, EUR/BRL)
 *  - Banco Central do Brasil → series SGS (SELIC, CDI, IPCA)
 *  - CoinGecko               → criptomonedas en USD con variación 24 h
 *
 * Son TOLERANTES A FALLOS por diseño: ante payloads malformados NUNCA lanzan; devuelven `null`
 * o `[]`. La decisión de negocio (conservar el último dato bueno) es del servicio.
 */

export interface MarketIndicator {
  /** Identificador estable ('usd-cop', 'selic', …); la landing lo usa para orden y estilos. */
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Unidad de presentación: moneda del precio o '%' para tasas. */
  readonly unit: 'COP' | 'BRL' | 'USD' | '%';
  /** Variación porcentual vs el punto anterior (o 24 h en cripto); `null` si no se conoce. */
  readonly changePct: number | null;
  /** Fecha del dato en ISO-8601, o `null` si el proveedor no la informa. */
  readonly asOf: string | null;
  /** Histórico (más antiguo → más reciente) para sparklines; `[]` si no hay serie. */
  readonly series: readonly number[];
}

/** TRM oficial (datos.gov.co, dataset 32sa-8pi3) pedida en orden DESC (más reciente primero). */
export function normalizeTrm(payload: unknown): MarketIndicator | null {
  if (!Array.isArray(payload)) return null;
  const points = payload
    .map((row) => ({
      value: toFiniteNumber((row as Record<string, unknown>)?.valor),
      asOf: toIsoDate((row as Record<string, unknown>)?.vigenciadesde),
    }))
    .filter(
      (p): p is { value: number; asOf: string | null } => p.value !== null,
    );
  if (points.length === 0) return null;

  const series = points.map((p) => p.value).reverse();
  const [latest, previous] = points;
  return {
    id: 'usd-cop',
    label: 'TRM (USD/COP)',
    value: latest.value,
    unit: 'COP',
    changePct: percentChange(latest.value, previous?.value),
    asOf: latest.asOf,
    series,
  };
}

/** Pares de AwesomeAPI que consumimos, con su presentación. */
const AWESOME_PAIRS: readonly {
  key: string;
  id: string;
  label: string;
  unit: MarketIndicator['unit'];
}[] = [
  { key: 'USDBRL', id: 'usd-brl', label: 'Dólar (USD/BRL)', unit: 'BRL' },
  { key: 'EURBRL', id: 'eur-brl', label: 'Euro (EUR/BRL)', unit: 'BRL' },
];

/** AwesomeAPI `json/last`: objeto con una entrada por par ({ USDBRL: { bid, pctChange, … } }). */
export function normalizeAwesome(payload: unknown): MarketIndicator[] {
  if (payload === null || typeof payload !== 'object') return [];
  const byPair = payload as Record<string, unknown>;
  const indicators: MarketIndicator[] = [];
  for (const pair of AWESOME_PAIRS) {
    const quote = byPair[pair.key] as Record<string, unknown> | undefined;
    const value = toFiniteNumber(quote?.bid);
    if (value === null) continue;
    indicators.push({
      id: pair.id,
      label: pair.label,
      value,
      unit: pair.unit,
      changePct: toFiniteNumber(quote?.pctChange),
      asOf: toIsoDate(quote?.create_date),
      series: [],
    });
  }
  return indicators;
}

/**
 * Serie SGS del BCB (`ultimos/N`): [{ data: 'dd/MM/yyyy', valor: '15.00' }]. El orden observado
 * NO es estable entre series (unas llegan ascendentes y otras descendentes), así que aquí se
 * ordena por fecha de forma explícita antes de elegir "último" y "anterior".
 */
export function normalizeSgs(
  payload: unknown,
  id: string,
  label: string,
): MarketIndicator | null {
  if (!Array.isArray(payload)) return null;
  const points = payload
    .map((row) => ({
      value: toFiniteNumber((row as Record<string, unknown>)?.valor),
      asOf: brDateToIso((row as Record<string, unknown>)?.data),
    }))
    .filter(
      (p): p is { value: number; asOf: string | null } => p.value !== null,
    )
    .sort((a, b) => (a.asOf ?? '').localeCompare(b.asOf ?? ''));
  if (points.length === 0) return null;

  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  return {
    id,
    label,
    value: latest.value,
    unit: '%',
    changePct: percentChange(latest.value, previous?.value),
    asOf: latest.asOf,
    series: points.map((p) => p.value),
  };
}

/** Monedas de CoinGecko que consumimos, con su presentación. */
const COINGECKO_COINS: readonly { key: string; id: string; label: string }[] = [
  { key: 'bitcoin', id: 'btc-usd', label: 'Bitcoin (USD)' },
  { key: 'ethereum', id: 'eth-usd', label: 'Ether (USD)' },
];

/** CoinGecko `simple/price`: { bitcoin: { usd, usd_24h_change }, … }. `asOf` lo pone el llamador. */
export function normalizeCoinGecko(
  payload: unknown,
  asOf: string | null,
): MarketIndicator[] {
  if (payload === null || typeof payload !== 'object') return [];
  const byCoin = payload as Record<string, unknown>;
  const indicators: MarketIndicator[] = [];
  for (const coin of COINGECKO_COINS) {
    const quote = byCoin[coin.key] as Record<string, unknown> | undefined;
    const value = toFiniteNumber(quote?.usd);
    if (value === null) continue;
    indicators.push({
      id: coin.id,
      label: coin.label,
      value,
      unit: 'USD',
      changePct: roundPct(toFiniteNumber(quote?.usd_24h_change)),
      asOf,
      series: [],
    });
  }
  return indicators;
}

/** Número finito desde string o number ('3252.11' → 3252.11); `null` si no es interpretable. */
function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Variación porcentual de `current` vs `previous`, a 2 decimales; `null` si no hay base. */
function percentChange(
  current: number,
  previous: number | undefined,
): number | null {
  if (previous === undefined || previous === 0) return null;
  return roundPct(((current - previous) / previous) * 100);
}

function roundPct(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

/**
 * Fecha de proveedor (ISO o 'yyyy-MM-dd HH:mm:ss') a ISO-8601; `null` si no es parseable.
 * Si no trae zona horaria (Socrata, AwesomeAPI) se asume UTC: el resultado debe ser el mismo
 * en cualquier máquina, no depender de la zona local del servidor.
 */
function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const normalized = raw.trim().replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const millis = Date.parse(withZone);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}

/** Fecha del BCB ('dd/MM/yyyy') a ISO-8601 (medianoche UTC); `null` si no calza el formato. */
function brDateToIso(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return toIsoDate(`${year}-${month}-${day}T00:00:00.000Z`);
}
