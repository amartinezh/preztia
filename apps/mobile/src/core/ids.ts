/**
 * Generación de identificadores para trazabilidad e idempotencia.
 *
 * - `correlationId`: una por petición, para correlacionar logs cliente↔servidor.
 * - `idempotencyKey`: una por operación de dinero, ESTABLE entre reintentos, para que
 *   reenvíos (red, cola offline) no produzcan doble abono/cobro (§3.7 confiabilidad).
 */

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }
  // Degradación: sin CSPRNG (motor antiguo). Suficiente para unicidad de claves de
  // correlación/idempotencia; no se usa para material criptográfico.
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** UUID v4 (RFC 4122) sin dependencias. */
export function uuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(b[i]!.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export const newCorrelationId = uuid;
export const newIdempotencyKey = uuid;
