/**
 * Formato de texto para Telegram (ADR #40, D7). Los casos de uso redactan con el marcado ligero de
 * WhatsApp (`*negrita*`, `_cursiva_`, `~tachado~`, `` `código` ``, ` ```bloque``` `). Telegram lo
 * mostraría literal; su modo HTML solo exige escapar `& < >`, a diferencia de MarkdownV2, que
 * obliga a escapar casi toda la puntuación y rompe con cualquier `.` o `-` del texto.
 *
 * Funciones puras: sin I/O.
 */

/** Límite de caracteres de un mensaje de la Bot API. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// Un marcador solo abre tras inicio/espacio/puntuación y solo cierra antes de fin/espacio/
// puntuación, con texto sin espacios en los bordes (misma regla que WhatsApp). Así no se
// convierten `pix_key`, `2*3*4` ni correos.
const OPENING_BOUNDARY = String.raw`(^|[\s(¡¿"'«])`;
const CLOSING_BOUNDARY = String.raw`(?=$|[\s).,;:!?"'»])`;

const INLINE_STYLES: readonly { marker: string; tag: string }[] = [
  { marker: '*', tag: 'b' },
  { marker: '_', tag: 'i' },
  { marker: '~', tag: 's' },
];

// Bloques ```…``` y código en línea `…`: su contenido NO se interpreta como marcado.
const CODE_SEGMENT = /```([\s\S]+?)```|`([^`\n]+)`/g;

/** Traduce el marcado ligero de WhatsApp a HTML de Telegram, escapando el resto del texto. */
export function whatsappMarkupToTelegramHtml(text: string): string {
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(CODE_SEGMENT)) {
    html += formatInline(text.slice(cursor, match.index));
    html +=
      match[1] !== undefined
        ? `<pre>${escapeHtml(match[1])}</pre>`
        : `<code>${escapeHtml(match[2])}</code>`;
    cursor = match.index + match[0].length;
  }
  return html + formatInline(text.slice(cursor));
}

function formatInline(text: string): string {
  return INLINE_STYLES.reduce(
    (html, { marker, tag }) =>
      html.replace(styleRegex(marker), `$1<${tag}>$2</${tag}>`),
    escapeHtml(text),
  );
}

function styleRegex(marker: string): RegExp {
  const m = `\\${marker}`;
  return new RegExp(
    `${OPENING_BOUNDARY}${m}(?=\\S)([^${m}\\n]*?\\S)${m}${CLOSING_BOUNDARY}`,
    'g',
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parte un texto largo en mensajes que caben en Telegram, cortando por párrafo y, si hace falta,
 * por línea o espacio (nunca a mitad de palabra salvo una palabra más larga que el límite). Se
 * parte el texto ORIGINAL (antes de convertir a HTML) para no cortar una etiqueta por la mitad;
 * `limit` deja margen para las etiquetas que añade la conversión.
 */
export function splitForTelegram(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = bestCut(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0 || chunks.length === 0) chunks.push(rest);
  return chunks;
}

function bestCut(text: string, limit: number): number {
  const window = text.slice(0, limit);
  for (const separator of ['\n\n', '\n', ' ']) {
    const at = window.lastIndexOf(separator);
    if (at > 0) return at + separator.length;
  }
  return limit;
}
