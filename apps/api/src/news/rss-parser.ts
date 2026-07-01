/**
 * Parser RSS/Atom mínimo y PURO (sin I/O, sin framework, sin dependencias): recibe el XML de un
 * feed y devuelve sus titulares normalizados. Vive junto al módulo (y no en `packages/domain`)
 * porque es una utilidad genérica de infraestructura, no una regla del dominio de préstamos.
 *
 * Cubre los dos formatos que sirven los portales de noticias:
 *  - RSS 2.0  → `<item>`  con `<title>` `<link>` `<pubDate>` `<source>`
 *  - Atom 1.0 → `<entry>` con `<title>` `<link href>` `<published|updated>`
 *
 * Es TOLERANTE A FALLOS por diseño: ante XML malformado NUNCA lanza; devuelve lo que pudo extraer
 * (posiblemente `[]`). La decisión de negocio (qué hacer si un feed no trae nada) es del servicio.
 */

export interface NewsItem {
  readonly title: string;
  readonly link: string;
  /** Medio atribuido (del `<source>` del feed o, si no viene, la etiqueta del feed). */
  readonly source: string;
  /** ISO-8601, o `null` si el feed no trae una fecha válida. */
  readonly publishedAt: string | null;
}

// Un titular es un bloque <item>…</item> (RSS) o <entry>…</entry> (Atom).
const ITEM_BLOCK = /<(item|entry)\b[\s\S]*?<\/\1>/gi;

/** Extrae y normaliza los titulares de un feed. `fallbackSource` se usa si el ítem no atribuye medio. */
export function parseFeed(xml: string, fallbackSource: string): NewsItem[] {
  if (!xml) return [];
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(ITEM_BLOCK)) {
    const block = match[0];
    const title = clean(tagContent(block, 'title'));
    const link = extractLink(block);
    // Sin título o sin enlace no es un titular útil para la landing: se descarta.
    if (!title || !link) continue;
    items.push({
      title,
      link,
      source: clean(tagContent(block, 'source')) || fallbackSource,
      publishedAt: parseDate(
        tagContent(block, 'pubDate') ??
          tagContent(block, 'published') ??
          tagContent(block, 'updated') ??
          tagContent(block, 'dc:date'),
      ),
    });
  }
  return items;
}

/** Contenido del primer `<tag>…</tag>` del bloque (o `null`). */
function tagContent(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  return re.exec(block)?.[1] ?? null;
}

/** Enlace del ítem: `href` de Atom (rel "alternate" o sin rel) o el `<link>` de texto de RSS. */
function extractLink(block: string): string | null {
  for (const m of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = m[1];
    const href = /\bhref\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
    if (!href) continue;
    const rel = /\brel\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
    if (!rel || rel === 'alternate') return clean(href);
  }
  const textLink = tagContent(block, 'link');
  return textLink ? clean(textLink) : null;
}

/** Quita CDATA y HTML incrustado, decodifica entidades y recorta espacios. */
function clean(raw: string | null): string {
  if (!raw) return '';
  const withoutMarkup = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
  return decodeEntities(withoutMarkup).trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

function fromCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
}

/** Normaliza cualquier fecha de feed (RFC-822 o ISO) a ISO-8601; `null` si no es parseable. */
function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const millis = Date.parse(clean(raw));
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}
