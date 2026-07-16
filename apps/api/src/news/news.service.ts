import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parseFeed, type NewsItem } from './rss-parser';
import { PLATFORM_CHANGELOG, type ChangelogEntry } from './platform-changelog';

/** Una fuente del "pulso del sector": una etiqueta legible + la URL de su feed RSS/Atom. */
interface FeedSource {
  readonly label: string;
  readonly url: string;
}

/** Titular del sector con su sección editorial (la etiqueta del feed que lo trajo). */
export interface SectorNewsItem extends NewsItem {
  readonly topic: string;
}

/** Lo que la landing consume: titulares del sector + changelog propio + marca de tiempo. */
export interface NewsSnapshot {
  readonly updatedAt: string | null;
  readonly sector: readonly SectorNewsItem[];
  readonly platform: readonly ChangelogEntry[];
}

// Feeds por defecto: secciones editoriales de la portada. Se usa Google News RSS (robusto,
// pensado para consumirse y con la fuente atribuida en cada ítem) mezclando el mercado
// hispano (es-419) con el brasileño (PIX). Se pueden reemplazar con NEWS_FEEDS.
const DEFAULT_FEEDS: readonly FeedSource[] = [
  {
    label: 'Economía',
    url: 'https://news.google.com/rss/search?q=econom%C3%ADa+colombia&hl=es-419&gl=CO&ceid=CO:es-419',
  },
  {
    label: 'Finanzas y crédito',
    url: 'https://news.google.com/rss/search?q=cr%C3%A9dito+OR+banca+OR+tasas+inter%C3%A9s&hl=es-419&gl=CO&ceid=CO:es-419',
  },
  {
    label: 'Mercados',
    url: 'https://news.google.com/rss/search?q=d%C3%B3lar+OR+bolsa+OR+mercados&hl=es-419&gl=CO&ceid=CO:es-419',
  },
  {
    label: 'Criptomonedas',
    url: 'https://news.google.com/rss/search?q=bitcoin+OR+criptomonedas&hl=es-419&gl=CO&ceid=CO:es-419',
  },
  {
    label: 'Fintech',
    url: 'https://news.google.com/rss/search?q=fintech+latinoam%C3%A9rica+OR+colombia&hl=es-419&gl=CO&ceid=CO:es-419',
  },
  {
    label: 'PIX y pagos',
    url: 'https://news.google.com/rss/search?q=PIX+pagamentos&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  },
];

const MAX_ITEMS = toPositiveInt(process.env.NEWS_MAX_ITEMS, 48);
const MAX_ITEMS_PER_TOPIC = toPositiveInt(process.env.NEWS_MAX_PER_TOPIC, 8);
const FETCH_TIMEOUT_MS = toPositiveInt(process.env.NEWS_FETCH_TIMEOUT_MS, 8000);

/**
 * Agregador del "pulso del sector". Mantiene un snapshot EN MEMORIA: el cron lo refresca y el
 * controlador lo sirve. Es resiliente por diseño — si un feed cae, sigue con los demás; si
 * TODOS caen, conserva el último snapshot bueno (degradación elegante). La selección se
 * balancea por sección (tope por topic) para que ninguna sección de la portada quede vacía
 * porque otra publica más rápido.
 */
@Injectable()
export class NewsService implements OnModuleInit {
  private readonly logger = new Logger('News:Service');
  private readonly feeds = parseFeedsEnv(process.env.NEWS_FEEDS);
  private snapshot: NewsSnapshot = {
    updatedAt: null,
    sector: [],
    platform: PLATFORM_CHANGELOG,
  };

  onModuleInit(): void {
    // En pruebas no salimos a la red. En producción el primer refresco corre en segundo plano
    // para no bloquear el arranque ni el healthcheck; el endpoint sirve el changelog de inmediato.
    if (process.env.NODE_ENV === 'test') return;
    void this.refresh();
  }

  getSnapshot(): NewsSnapshot {
    return this.snapshot;
  }

  /** Recarga los titulares de todas las fuentes. Conserva el snapshot previo si nada llega. */
  async refresh(): Promise<void> {
    const results = await Promise.allSettled(
      this.feeds.map((feed) => this.loadFeed(feed)),
    );
    const items = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );

    if (items.length === 0) {
      this.logger.warn(
        'Ningún feed devolvió titulares; se conserva el snapshot anterior',
      );
      return;
    }

    const sector = selectBalanced(dedupeByLink(items));
    this.snapshot = {
      updatedAt: new Date().toISOString(),
      sector,
      platform: PLATFORM_CHANGELOG,
    };
    this.logger.log(
      `Pulso del sector actualizado: ${sector.length} titulares de ${this.feeds.length} feeds`,
    );
  }

  private async loadFeed(feed: FeedSource): Promise<readonly SectorNewsItem[]> {
    try {
      const res = await fetch(feed.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'user-agent': 'PreztiaOS-NewsBot/1.0',
          accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml',
        },
      });
      if (!res.ok) {
        this.logger.warn(`Feed "${feed.label}" respondió ${res.status}`);
        return [];
      }
      return parseFeed(await res.text(), feed.label).map((item) => ({
        ...item,
        topic: feed.label,
      }));
    } catch (err) {
      this.logger.warn(
        `Feed "${feed.label}" no disponible: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}

/** Formato de NEWS_FEEDS: `Etiqueta|url` por fuente, separadas por `;`. Vacío → feeds por defecto. */
function parseFeedsEnv(raw: string | undefined): readonly FeedSource[] {
  if (!raw?.trim()) return DEFAULT_FEEDS;
  const feeds = raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf('|');
      const label = sep >= 0 ? entry.slice(0, sep).trim() : 'Sector';
      const url = (sep >= 0 ? entry.slice(sep + 1) : entry).trim();
      return { label, url };
    })
    .filter((feed) => feed.url.startsWith('http'));
  return feeds.length ? feeds : DEFAULT_FEEDS;
}

/**
 * Selección balanceada: lo más nuevo de CADA sección (tope por topic) y luego un orden global
 * por fecha, con tope total. Invariante: ningún topic aporta más de MAX_ITEMS_PER_TOPIC ítems.
 */
function selectBalanced(items: readonly SectorNewsItem[]): SectorNewsItem[] {
  const byTopic = new Map<string, SectorNewsItem[]>();
  for (const item of [...items].sort(byNewest)) {
    const bucket = byTopic.get(item.topic) ?? [];
    if (bucket.length >= MAX_ITEMS_PER_TOPIC) continue;
    bucket.push(item);
    byTopic.set(item.topic, bucket);
  }
  return [...byTopic.values()].flat().sort(byNewest).slice(0, MAX_ITEMS);
}

function dedupeByLink(items: readonly SectorNewsItem[]): SectorNewsItem[] {
  const seen = new Set<string>();
  const unique: SectorNewsItem[] = [];
  for (const item of items) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    unique.push(item);
  }
  return unique;
}

function byNewest(a: NewsItem, b: NewsItem): number {
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return tb - ta;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
