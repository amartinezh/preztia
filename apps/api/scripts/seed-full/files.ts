import { crc32, deflateSync } from 'node:zlib';
import { EncryptedFileBucket } from '../../src/shared/encrypted-file-bucket';
import { sha256Of } from './fake-data';

// Evidencias BINARIAS del seed: comprobantes PIX, documentos KYC, recibos de gastos y de
// consignaciones. Se generan imágenes PNG y PDF reales (legibles en la app) y se suben CIFRADAS a
// MinIO con el mismo bucket y las mismas claves que usa la API, así "ver original" funciona.

export const PNG_MIME = 'image/png';
export const PDF_MIME = 'application/pdf';

export interface StoredFile {
  /** null cuando no se pudo subir (MinIO caído o `SEED_SKIP_FILES`): la app no ofrece el original. */
  readonly storageKey: string | null;
  readonly sha256: string;
  readonly mimeType: string;
}

/**
 * Bóveda de archivos best-effort: si MinIO no responde, avisa una sola vez y sigue sin archivos
 * (las filas quedan con `storage_key` NULL, un estado que la app ya contempla).
 */
export class FileVault {
  private readonly bucket = new EncryptedFileBucket();
  private enabled: boolean;
  private warned = false;
  uploaded = 0;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  async put(key: string, bytes: Buffer, mimeType: string): Promise<StoredFile> {
    if (!this.enabled)
      return { storageKey: null, sha256: sha256Of(bytes), mimeType };
    try {
      const { sha256 } = await this.bucket.put(key, bytes, mimeType);
      this.uploaded += 1;
      return { storageKey: key, sha256, mimeType };
    } catch (err) {
      this.disable(err);
      return { storageKey: null, sha256: sha256Of(bytes), mimeType };
    }
  }

  private disable(err: unknown): void {
    this.enabled = false;
    if (this.warned) return;
    this.warned = true;
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `⚠️  MinIO no disponible (${reason}); se continúa SIN archivos originales.`,
    );
  }
}

// ── PNG con texto (fuente bitmap 5×7) ───────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_SPACING = 1;
const LINE_SPACING = 4;
const MARGIN = 16;

// Cada glifo: 7 filas de 5 bits ('1' = píxel encendido).
const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '#': ['01010', '11111', '01010', '01010', '01010', '11111', '01010'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
  '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
};

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [33, 37, 41];

/** Lienzo RGB mínimo para componer comprobantes y fotos simuladas. */
class Canvas {
  private readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb = WHITE,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row++) {
      for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col++) {
        const i = (row * this.width + col) * 3;
        this.pixels[i] = color[0];
        this.pixels[i + 1] = color[1];
        this.pixels[i + 2] = color[2];
      }
    }
  }

  text(
    x: number,
    y: number,
    value: string,
    scale: number,
    color: Rgb = INK,
  ): void {
    let cursor = x;
    for (const char of normalizeForFont(value)) {
      const glyph = FONT[char] ?? FONT[' ']!;
      glyph.forEach((bits, row) => {
        for (let col = 0; col < GLYPH_WIDTH; col++) {
          if (bits[col] === '1') {
            this.rect(
              cursor + col * scale,
              y + row * scale,
              scale,
              scale,
              color,
            );
          }
        }
      });
      cursor += (GLYPH_WIDTH + GLYPH_SPACING) * scale;
    }
  }

  toPng(): Buffer {
    const rowLength = this.width * 3 + 1;
    const raw = Buffer.alloc(rowLength * this.height);
    for (let row = 0; row < this.height; row++) {
      raw[row * rowLength] = 0; // filtro "None"
      Buffer.from(
        this.pixels.buffer,
        row * this.width * 3,
        this.width * 3,
      ).copy(raw, row * rowLength + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bits por canal
    header[9] = 2; // RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
}

/** Mayúsculas sin tildes: la fuente bitmap solo cubre ASCII básico. */
function normalizeForFont(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

const TEXT_SCALE = 2;
const TITLE_SCALE = 3;
const LINE_HEIGHT = (GLYPH_HEIGHT + LINE_SPACING) * TEXT_SCALE;
const TITLE_HEIGHT = (GLYPH_HEIGHT + LINE_SPACING) * TITLE_SCALE;
const RECEIPT_WIDTH = 420;

/** Comprobante en imagen: banda de color con el título y líneas de texto. */
export function receiptPng(
  title: string,
  lines: readonly string[],
  accent: Rgb,
): Buffer {
  const height = MARGIN * 3 + TITLE_HEIGHT + lines.length * LINE_HEIGHT;
  const canvas = new Canvas(RECEIPT_WIDTH, height);
  canvas.rect(0, 0, RECEIPT_WIDTH, MARGIN + TITLE_HEIGHT, accent);
  canvas.text(MARGIN, MARGIN, title, TITLE_SCALE, WHITE);
  lines.forEach((line, i) => {
    canvas.text(
      MARGIN,
      MARGIN * 2 + TITLE_HEIGHT + i * LINE_HEIGHT,
      line,
      TEXT_SCALE,
    );
  });
  return canvas.toPng();
}

const STOREFRONT_WIDTH = 480;
const STOREFRONT_HEIGHT = 320;

/** "Foto" de la fachada del negocio: toldo a rayas, letrero con el nombre, puerta y vitrina. */
export function storefrontPng(businessName: string, palette: Rgb): Buffer {
  const canvas = new Canvas(
    STOREFRONT_WIDTH,
    STOREFRONT_HEIGHT,
    [196, 214, 230],
  );
  canvas.rect(0, 220, STOREFRONT_WIDTH, 100, [150, 150, 150]); // acera
  canvas.rect(40, 70, 400, 170, [236, 228, 210]); // fachada
  for (let i = 0; i < 10; i++) {
    canvas.rect(40 + i * 40, 60, 40, 30, i % 2 === 0 ? palette : WHITE); // toldo
  }
  canvas.rect(40, 20, 400, 40, INK); // letrero
  canvas.text(52, 30, businessName.slice(0, 30), 2, WHITE);
  canvas.rect(70, 120, 150, 90, [120, 170, 200]); // vitrina
  canvas.rect(270, 110, 70, 120, [110, 70, 40]); // puerta
  canvas.rect(330, 165, 6, 6, [230, 200, 60]); // pomo
  return canvas.toPng();
}

// ── PDF de una página con texto ─────────────────────────────────────────────────────────────

const PDF_FONT_SIZE = 11;
const PDF_TITLE_SIZE = 15;
const PDF_LEFT = 56;
const PDF_TOP = 780;
const PDF_LINE = 18;

/** PDF A4 mínimo y válido (Helvetica, WinAnsi) con un título y líneas de texto. */
export function documentPdf(title: string, lines: readonly string[]): Buffer {
  const body = [
    'BT',
    `/F1 ${PDF_TITLE_SIZE} Tf ${PDF_LEFT} ${PDF_TOP} Td (${pdfText(title)}) Tj`,
    `/F1 ${PDF_FONT_SIZE} Tf`,
    ...lines.map((line) => `0 -${PDF_LINE} Td (${pdfText(line)}) Tj`),
    'ET',
  ].join('\n');
  const stream = Buffer.from(body, 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function pdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export const ACCENTS: Readonly<Record<string, Rgb>> = {
  pix: [50, 188, 173],
  picpay: [17, 199, 111],
  inter: [255, 122, 0],
  expense: [94, 92, 230],
  deposit: [13, 110, 253],
  document: [73, 80, 87],
};
