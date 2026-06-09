import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la firma `X-Hub-Signature-256` que envía Meta: HMAC-SHA256 del cuerpo
 * crudo usando el App Secret. Comparación en tiempo constante para evitar fugas
 * por timing. Requiere el body sin reserializar (por eso `rawBody` en main.ts).
 */
export function isValidSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected =
    'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = Buffer.from(signatureHeader);
  const computed = Buffer.from(expected);
  return (
    received.length === computed.length && timingSafeEqual(received, computed)
  );
}
