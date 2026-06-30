import { createHmac, timingSafeEqual } from 'node:crypto';

// Verificación de la firma del webhook de Mercado Pago. Esquema vigente: HMAC-SHA256 sobre un
// MANIFEST (no el body crudo): `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, con la clave
// secreta del panel; la firma viaja en `x-signature: ts=<ts>,v1=<hmac_hex>`. Comparación en
// tiempo constante. La estrategia es configurable por si la notificación de "reporte listo"
// usara el esquema legado BCrypt(transaction_id + '-' + password + '-' + generation_date), que
// requeriría una dependencia (sujeta a autorización) y queda pendiente de confirmar contra una
// notificación productiva real (ver VALIDATION_MERCADOPAGO_PIX.md).

export type WebhookSignatureStrategy = 'hmac-sha256' | 'legacy-bcrypt';

export interface MercadoPagoSignatureInput {
  /** `data.id` del payload (el id de la notificación / transaction_id). */
  readonly dataId: string;
  /** Cabecera `x-request-id`. */
  readonly requestId: string | undefined;
  /** Cabecera `x-signature` (`ts=...,v1=...`). */
  readonly signatureHeader: string | undefined;
  /** Secreto de webhook del tenant (descifrado). */
  readonly secret: string;
  readonly strategy?: WebhookSignatureStrategy;
}

/** ¿La firma del webhook es auténtica? Defensivo: cualquier dato faltante → false. */
export function verifyMercadoPagoWebhook(
  input: MercadoPagoSignatureInput,
): boolean {
  const strategy = input.strategy ?? 'hmac-sha256';
  if (strategy === 'hmac-sha256') return verifyHmacSha256(input);
  // El esquema legado BCrypt aún no está soportado (necesitaría una librería bcrypt).
  return false;
}

function verifyHmacSha256(input: MercadoPagoSignatureInput): boolean {
  if (!input.secret) return false;
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return false;
  const manifest = `id:${input.dataId};request-id:${input.requestId ?? ''};ts:${parsed.ts};`;
  const expected = createHmac('sha256', input.secret)
    .update(manifest)
    .digest('hex');
  return safeEqual(parsed.v1, expected);
}

/** Extrae `ts` y `v1` de `x-signature` ("ts=<ts>,v1=<hex>"); null si falta alguno. */
function parseSignatureHeader(
  header: string | undefined,
): { ts: string; v1: string } | null {
  if (!header) return null;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }
  return ts && v1 ? { ts, v1 } : null;
}

/** Comparación en tiempo constante de dos strings (hex); longitudes distintas → false. */
function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
