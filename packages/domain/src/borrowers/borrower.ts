import { DomainError } from "../shared/money";

// Dominio puro del CLIENTE (deudor). Reglas e invariantes del registro de clientes que el
// sistema legado llama "Cliente": color de etiqueta, cupo (límite de crédito) y bloqueo de
// nuevos créditos. Sin I/O ni framework; la frontera (zod) ya entrega datos bien formados.

/**
 * Etiqueta de color del cliente (espejo de las opciones del legado: Amarillo/Azul/Rojo/
 * Verde/Naranja/Ninguno). `NONE` = sin etiqueta. Identificadores en inglés (convención §18).
 */
export const BORROWER_COLORS = [
  "NONE",
  "YELLOW",
  "BLUE",
  "RED",
  "GREEN",
  "ORANGE",
] as const;

export type BorrowerColor = (typeof BORROWER_COLORS)[number];

export function isBorrowerColor(value: string): value is BorrowerColor {
  return (BORROWER_COLORS as readonly string[]).includes(value);
}

/**
 * Normaliza la cédula (national_id): colapsa espacios internos y recorta extremos. Se conserva
 * tal cual el resto de caracteres (el legado admite cédulas con signo/formatos variados); la
 * validación de unicidad la impone la persistencia (índice único por tenant).
 */
export function normalizeNationalId(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Cupo no negativo y entero (unidades menores). Falla rápido ante entradas inválidas. */
export function assertCreditLimitMinor(creditLimitMinor: number): void {
  if (!Number.isInteger(creditLimitMinor) || creditLimitMinor < 0) {
    throw new DomainError("El cupo debe ser un entero no negativo en unidades menores");
  }
}

export interface BorrowerCreditPolicy {
  /** Si el cliente está bloqueado para recibir nuevos créditos (Créditos → Bloquear). */
  readonly creditBlocked: boolean;
  /**
   * Cupo aprobado (límite de crédito) en unidades menores. `0` = "sin cupo asignado": no impone
   * tope, de modo que un cliente puede tener varios créditos simultáneos. Un valor > 0 sí limita
   * la exposición total (saldo vigente + solicitado).
   */
  readonly creditLimitMinor: number;
}

export interface CreditRequest {
  /** Capital del crédito solicitado (unidades menores). */
  readonly requestedMinor: number;
  /** Saldo vigente del cliente en créditos activos (unidades menores). */
  readonly outstandingMinor: number;
}

/** Motivos por los que se niega un crédito (estables para la frontera/UI). */
export const CREDIT_DENIED_BLOCKED = "BLOCKED" as const;
export const CREDIT_DENIED_OVER_LIMIT = "OVER_LIMIT" as const;

export type CreditDenialReason =
  | typeof CREDIT_DENIED_BLOCKED
  | typeof CREDIT_DENIED_OVER_LIMIT;

export type CreditDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: CreditDenialReason };

/**
 * Decide si un cliente puede recibir un crédito nuevo: no puede estar bloqueado y, si tiene un
 * cupo asignado (> 0), el saldo vigente más lo solicitado no puede excederlo. Un cupo de `0`
 * significa "sin cupo": no limita el monto, lo que permite varios créditos por cliente. Decisión
 * pura (no lanza): la frontera traduce el rechazo a 409/422 según corresponda.
 *
 * Invariante: cuando `creditLimitMinor > 0` y `allowed === true`, se cumple
 * `outstandingMinor + requestedMinor ≤ creditLimitMinor`.
 */
export function canReceiveCredit(
  policy: BorrowerCreditPolicy,
  request: CreditRequest,
): CreditDecision {
  if (policy.creditBlocked) {
    return { allowed: false, reason: CREDIT_DENIED_BLOCKED };
  }
  const hasLimit = policy.creditLimitMinor > 0;
  if (hasLimit && request.outstandingMinor + request.requestedMinor > policy.creditLimitMinor) {
    return { allowed: false, reason: CREDIT_DENIED_OVER_LIMIT };
  }
  return { allowed: true };
}
