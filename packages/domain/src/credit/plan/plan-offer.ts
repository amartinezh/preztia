import { ConflictError } from "../../shared/money";

// Máquina de estados pura de la NEGOCIACIÓN del plan de pago (Fase 10). Espeja el enum
// `plan_offer_status` de BD. No conoce I/O ni framework: solo decide la transición válida.

export type PlanOfferStatus =
  | "NOT_OFFERED"
  | "AWAITING_SELECTION"
  | "AWAITING_ACCEPTANCE"
  | "ACCEPTED"
  | "DECLINED";

export type PlanOfferAction = "OFFER" | "SELECT" | "ACCEPT" | "DECLINE";

// Transiciones permitidas. `OFFER` admite dos destinos según el toggle de autonomía del cliente;
// el caso de uso elige el destino concreto y lo valida contra esta tabla con `assertOfferTransition`.
const TRANSITIONS: Record<PlanOfferStatus, Partial<Record<PlanOfferAction, PlanOfferStatus[]>>> = {
  NOT_OFFERED: { OFFER: ["AWAITING_SELECTION", "AWAITING_ACCEPTANCE"] },
  // Re-ofertar tras un rechazo o un vencimiento es válido.
  DECLINED: { OFFER: ["AWAITING_SELECTION", "AWAITING_ACCEPTANCE"] },
  AWAITING_SELECTION: {
    SELECT: ["AWAITING_ACCEPTANCE"],
    DECLINE: ["DECLINED"],
    // Re-ofertar (p. ej. la oferta venció) reinicia la negociación.
    OFFER: ["AWAITING_SELECTION", "AWAITING_ACCEPTANCE"],
  },
  AWAITING_ACCEPTANCE: {
    ACCEPT: ["ACCEPTED"],
    DECLINE: ["DECLINED"],
    OFFER: ["AWAITING_SELECTION", "AWAITING_ACCEPTANCE"],
  },
  // Estado terminal del lado del cliente: el botón final crea el crédito.
  ACCEPTED: {},
};

/**
 * Valida que `current --action--> target` sea una transición permitida de la oferta. Lanza
 * `ConflictError` (→ 409) si no lo es (p. ej. ofertar un expediente ya ACCEPTED).
 */
export function assertOfferTransition(
  current: PlanOfferStatus,
  action: PlanOfferAction,
  target: PlanOfferStatus,
): void {
  const allowed = TRANSITIONS[current]?.[action];
  if (!allowed || !allowed.includes(target)) {
    throw new ConflictError(
      `Transición de oferta inválida: ${current} --${action}--> ${target}`,
    );
  }
}

/** La oferta venció si hay vencimiento y ya pasó (comparación pura; el reloj lo inyecta la app). */
export function isOfferExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() > expiresAt.getTime();
}

const MILLIS_PER_HOUR = 60 * 60 * 1000;

/** Calcula el vencimiento de la oferta a partir del TTL en horas del tenant (≥ 1). */
export function offerExpiryFrom(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * MILLIS_PER_HOUR);
}
