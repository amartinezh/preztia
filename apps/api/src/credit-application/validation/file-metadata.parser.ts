import { type FileTechnicalMetadata } from '@preztiaos/domain';

// Extracción de metadata técnica de PDF y JPEG en TS puro (sin binarios externos
// ni dependencias). Es BEST-EFFORT: si el formato no trae metadata legible se
// devuelven nulls y el dominio no penaliza (reviewFileMetadata tolera ausencia).
// Lo que importa al antifraude: Producer/Creator/Software y fechas de creación
// y modificación (un documento oficial hecho en Photoshop/Canva es bandera roja).

const PDF_MAGIC = '%PDF';
const JPEG_MAGIC = 0xffd8;

/** Extrae la metadata técnica del binario según su tipo; null si no aplica. */
export function parseFileMetadata(
  bytes: Uint8Array,
  mimeType: string,
): FileTechnicalMetadata | null {
  if (mimeType === 'application/pdf') return parsePdfMetadata(bytes);
  if (mimeType.startsWith('image/jpeg')) return parseJpegMetadata(bytes);
  return null;
}

// ── PDF: campos del Info dictionary, leídos sobre el texto plano del archivo ──

function parsePdfMetadata(bytes: Uint8Array): FileTechnicalMetadata | null {
  const text = Buffer.from(bytes).toString('latin1');
  if (!text.startsWith(PDF_MAGIC)) return null;
  return {
    producer: pdfStringField(text, 'Producer'),
    creator: pdfStringField(text, 'Creator') ?? xmpField(text, 'CreatorTool'),
    software: null,
    createDate: pdfDateToIso(pdfStringField(text, 'CreationDate')),
    modifyDate: pdfDateToIso(pdfStringField(text, 'ModDate')),
  };
}

// Valor literal `(...)` de una clave del Info dictionary; la última aparición
// gana (los PDF actualizados de forma incremental re-declaran el diccionario).
function pdfStringField(text: string, key: string): string | null {
  const pattern = new RegExp(`\\/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`, 'g');
  let value: string | null = null;
  for (const match of text.matchAll(pattern)) {
    value = match[1] ?? null;
  }
  return value ? unescapePdfString(value).trim() || null : null;
}

function unescapePdfString(value: string): string {
  return value.replace(/\\([()\\nrt])/g, (_, ch: string) =>
    ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch,
  );
}

// Metadata XMP embebida (xpacket): fallback para PDFs que no exponen Info dict.
function xmpField(text: string, key: string): string | null {
  const match = new RegExp(`xmp:${key}="([^"]*)"`).exec(text);
  return match?.[1]?.trim() || null;
}

// Fecha PDF "D:YYYYMMDDHHmmSS±HH'mm'" → ISO 8601.
function pdfDateToIso(value: string | null): string | null {
  if (!value) return null;
  const match =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})?'?(\d{2})?)?/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, tzSign, tzHour, tzMinute] =
    match;
  const date = `${year}-${month ?? '01'}-${day ?? '01'}`;
  const time = `${hour ?? '00'}:${minute ?? '00'}:${second ?? '00'}`;
  const offset =
    tzSign === 'Z' || !tzSign
      ? 'Z'
      : `${tzSign}${tzHour ?? '00'}:${tzMinute ?? '00'}`;
  return `${date}T${time}${offset}`;
}

// ── JPEG: tags EXIF de IFD0 (Software 0x0131, DateTime 0x0132) ──

const EXIF_TAG_SOFTWARE = 0x0131;
const EXIF_TAG_DATETIME = 0x0132;
const EXIF_TYPE_ASCII = 2;
const APP1_MARKER = 0xffe1;
const SOS_MARKER = 0xffda;

function parseJpegMetadata(bytes: Uint8Array): FileTechnicalMetadata | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== JPEG_MAGIC) return null;

  const exif = findExifSegment(view);
  if (!exif) {
    return {
      producer: null,
      creator: null,
      software: null,
      createDate: null,
      modifyDate: null,
    };
  }

  const tags = readIfd0AsciiTags(view, exif);
  const dateTime = exifDateToIso(tags.get(EXIF_TAG_DATETIME) ?? null);
  return {
    producer: null,
    creator: null,
    software: tags.get(EXIF_TAG_SOFTWARE) ?? null,
    createDate: null,
    // EXIF DateTime (0x0132) es la fecha de ÚLTIMA modificación de la imagen.
    modifyDate: dateTime,
  };
}

// Recorre los segmentos JPEG hasta hallar APP1/"Exif\0\0"; null si no existe.
function findExifSegment(view: DataView): number | null {
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === SOS_MARKER) return null; // empezó la imagen: ya no hay metadata
    if (marker === APP1_MARKER && offset + 10 <= view.byteLength) {
      const isExif =
        view.getUint32(offset + 4) === 0x45786966 &&
        view.getUint16(offset + 8) === 0x0000;
      if (isExif) return offset + 10; // inicio del header TIFF
    }
    offset += 2 + size;
  }
  return null;
}

// Lee los tags ASCII del IFD0 del bloque TIFF (maneja little y big endian).
function readIfd0AsciiTags(
  view: DataView,
  tiffStart: number,
): Map<number, string> {
  const tags = new Map<number, string>();
  if (tiffStart + 8 > view.byteLength) return tags;
  const littleEndian = view.getUint16(tiffStart) === 0x4949; // "II"
  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd = tiffStart + ifdOffset;
  if (ifd + 2 > view.byteLength) return tags;

  const entryCount = view.getUint16(ifd, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    if (
      type !== EXIF_TYPE_ASCII ||
      (tag !== EXIF_TAG_SOFTWARE && tag !== EXIF_TAG_DATETIME)
    ) {
      continue;
    }
    const count = view.getUint32(entry + 4, littleEndian);
    const valueOffset =
      count <= 4
        ? entry + 8
        : tiffStart + view.getUint32(entry + 8, littleEndian);
    if (valueOffset + count > view.byteLength) continue;
    const raw = Buffer.from(
      view.buffer,
      view.byteOffset + valueOffset,
      count,
    ).toString('ascii');
    const value = raw.replace(/\0+$/, '').trim();
    if (value) tags.set(tag, value);
  }
  return tags;
}

// EXIF "YYYY:MM:DD HH:MM:SS" → ISO 8601 (sin zona conocida: se asume UTC).
function exifDateToIso(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    value,
  );
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}
