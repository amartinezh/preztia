// Regla PURA del archivo de comprobante que sube el personal de campo (gasto, consignación): no
// vacío, de un tipo admitido (fotos, incluida HEIC de iPhone, y PDF) y dentro del tamaño máximo.

import { DomainError } from "./money";

/** Tamaño máximo de un comprobante: 8 MB. */
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

export const RECEIPT_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

export function assertValidReceiptFile(input: { mimeType: string; sizeBytes: number }): void {
  if (input.sizeBytes <= 0) throw new DomainError("El comprobante es obligatorio");
  if (input.sizeBytes > RECEIPT_MAX_BYTES) {
    throw new DomainError("El comprobante supera el tamaño máximo (8 MB)");
  }
  if (!RECEIPT_MIME_TYPES.includes(input.mimeType)) {
    throw new DomainError("El comprobante debe ser una foto (JPG, PNG, WEBP, HEIC) o un PDF");
  }
}
