import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parseFeed, type NewsItem } from './rss-parser';
import { PLATFORM_CHANGELOG, type ChangelogEntry } from './platform-changelog';

/** Una fuente del "pulso del sector": una etiqueta legible + la URL de su feed RSS/Atom. */
interface FeedSource {
  readonly label: string;
  readonly url: string;
}

/** Lo que la landing consume: titulares del sector + changelog propio + marca de tiempo. */
export interface NewsSnapshot {
  readonly updatedAt: string | null;
  readonly sector: readonly NewsItem[];
  readonly platform: readonly ChangelogEntry[];
}

// Feeds por defecto (Brasil). Se usa Google News RSS: robusto, pensado para consumirse y
// devuelve la fuente atribuida en cada ítem. Se pueden reemplazar con NEWS_FEEDS.
const DEFAULT_FEEDS: readonly FeedSource[] = [
  {
    label: 'Fintech Brasil',
    url: 'https://news.google.com/rss/search?q=fintech+OR+cr%C3%A9dito+brasil&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  },
  {
    label: 'Economía',
    url: 'https://news.google.com/rss/search?q=economia+brasil&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  },
  {
    label: 'PIX y pagos',
    url: 'https://news.google.com/rss/search?q=PIX+pagamentos&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  },
];

const MAX_ITEMS = toPositiveInt(process.env.NEWS_MAX_ITEMS, 12);
const FETCH_TIMEOUT_MS = toPositiveInt(process.env.NEWS_FETCH_TIMEOUT_MS, 8000);

/**
 * Agregador del "pulso del sector". Mantiene un snapshot EN MEMORIA (una lectura por día basta):
 * el cron lo refresca y el controlador lo sirve. Es resiliente por diseño — si un feed cae, sigue
 * con los demás; si TODOS caen, conserva el último snapshot bueno (degradación elegante).
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

    const sector = dedupeByLink(items).sort(byNewest).slice(0, MAX_ITEMS);
    this.snapshot = {
      updatedAt: new Date().toISOString(),
      sector,
      platform: PLATFORM_CHANGELOG,
    };
    this.logger.log(
      `Pulso del sector actualizado: ${sector.length} titulares de ${this.feeds.length} feeds`,
    );
  }

  private async loadFeed(feed: FeedSource): Promise<readonly NewsItem[]> {
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
      return parseFeed(await res.text(), feed.label);
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

function dedupeByLink(items: readonly NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const unique: NewsItem[] = [];
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
