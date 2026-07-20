// Política pura de VISITAS DE COBRO EN CAMPO. Reglas e invariantes del agendamiento de visitas;
// sin I/O, sin framework, sin SQL. El cobrador debe visitar a los clientes cuyo crédito acumula
// ≥ `threshold` cuotas vencidas (umbral configurable por el admin del tenant). Tras marcar la
// visita, el cliente sale de "pendientes" y solo reaparece cuando la mora crece otro `threshold`
// respecto al nivel que tenía en la última visita: visitado con 3 cuotas vencidas y umbral 3 →
// reaparece a las 6 (3 → 6 → 9 …).

import { ConflictError, DomainError } from "../../shared/money";

/** Mínimo de cuotas vencidas que se puede configurar como umbral (evita un umbral 0 sin sentido). */
export const MIN_VISIT_OVERDUE_THRESHOLD = 1;

/** Estado de agendamiento de un crédito para decidir si toca visitarlo. */
export interface VisitSchedulingState {
  /** Nº de cuotas vencidas actuales del crédito. */
  readonly overdueCount: number;
  /** Umbral configurado (cuotas vencidas) para agendar y reagendar la visita. */
  readonly threshold: number;
  /** Cuotas vencidas registradas en la última visita; `null` si nunca se ha visitado. */
  readonly lastVisitOverdueCount: number | null;
}

/**
 * ¿El crédito debe aparecer en la lista de "pendientes por visitar"? Cierto cuando la mora
 * alcanza el umbral por primera vez, o cuando crece otro umbral completo desde la última visita.
 */
export function needsVisit(state: VisitSchedulingState): boolean {
  const { overdueCount, threshold, lastVisitOverdueCount } = state;
  if (overdueCount < threshold) return false;
  if (lastVisitOverdueCount === null) return true;
  return overdueCount >= lastVisitOverdueCount + threshold;
}

/**
 * ¿El crédito ya fue visitado en el ciclo de mora vigente? Cierto cuando ya tiene al menos una
 * visita y todavía no vuelve a necesitar otra (está "cubierto"). Alimenta la pestaña "Visitados".
 */
export function isVisitedInCurrentCycle(state: VisitSchedulingState): boolean {
  return state.lastVisitOverdueCount !== null && !needsVisit(state);
}

/** Entrada para validar el marcado de una visita como realizada. */
export interface MarkVisitedCheck {
  readonly overdueCount: number;
  readonly threshold: number;
  readonly lastVisitOverdueCount: number | null;
  /** ¿Hay una observación registrada DESPUÉS de la última visita (o alguna, si nunca se visitó)? */
  readonly hasFreshObservation: boolean;
}

/**
 * Verifica que se puede MARCAR como visitado; fallo rápido (DomainError) en caso contrario:
 * - no alcanza el umbral (no había motivo para visitar) → 400 `BELOW_VISIT_THRESHOLD`.
 * - el ciclo ya está cubierto por una visita previa → 409 `ALREADY_VISITED` (sin doble registro).
 * - no hay una observación nueva desde la última visita → 400 `NO_FRESH_OBSERVATION`.
 */
export function assertCanMarkVisited(input: MarkVisitedCheck): void {
  if (input.overdueCount < input.threshold) {
    throw new DomainError(
      "El crédito no alcanza el umbral de cuotas vencidas para registrar una visita",
      "BELOW_VISIT_THRESHOLD",
    );
  }
  if (!needsVisit(input)) {
    throw new ConflictError(
      "El cliente ya fue visitado en este ciclo de mora",
      "ALREADY_VISITED",
    );
  }
  if (!input.hasFreshObservation) {
    throw new DomainError(
      "Debes registrar una observación nueva antes de marcar la visita",
      "NO_FRESH_OBSERVATION",
    );
  }
}
