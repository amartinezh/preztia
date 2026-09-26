// Dominio puro de las PARADAS de una orden de ruta (sin I/O).
//
// El sistema propone clientes que necesitan visita; el coordinador reparte las paradas entre
// cobradores y despacha. El cobrador ve una vista MÍNIMA de cada parada mientras está abierta y la
// liquida con un resultado: pagó (monto), no pagó (motivo), promesa (fecha) o no encontrado.
//
// Invariantes:
// - una parada abierta por cliente en un despacho (sin repetidos);
// - solo PAGÓ lleva monto (> 0); NO PAGÓ exige motivo; PROMESA exige fecha de hoy en adelante;
// - una parada resuelta o cancelada es final (y deja de dar acceso a los datos del cliente).

import { ConflictError, DomainError } from "../../shared/money";

export type StopStatus = "ASSIGNED" | "SEEN" | "RESOLVED" | "CANCELLED";
export type StopOutcome = "PAID" | "NOT_PAID" | "PROMISE" | "NOT_FOUND";

const OPEN_STATUSES: readonly StopStatus[] = ["ASSIGNED", "SEEN"];
const MIN_REASON_LENGTH = 3;

/** Cuota reducida a lo que importa para el monto a cobrar. */
export interface DueInstallment {
  readonly dueDate: string; // YYYY-MM-DD
  readonly amountDueMinor: number;
  readonly paidMinor: number;
}

/**
 * Monto a cobrar en la visita: lo pendiente de las cuotas YA vencidas (vencimiento anterior a
 * hoy). Lo que vence hoy no está en mora todavía.
 */
export function overdueAmountMinor(installments: readonly DueInstallment[], today: string): number {
  return installments
    .filter((i) => i.dueDate < today)
    .reduce((acc, i) => acc + Math.max(0, i.amountDueMinor - i.paidMinor), 0);
}

/** Un despacho tiene paradas y no repite cliente (crédito). */
export function assertDispatchable(stops: readonly { creditId: string; collectorId: string }[]): void {
  if (stops.length === 0) throw new DomainError("La ruta debe tener al menos una parada");
  const credits = new Set(stops.map((s) => s.creditId));
  if (credits.size !== stops.length) {
    throw new DomainError("Un cliente no puede estar dos veces en la misma ruta");
  }
}

/** ¿La parada da acceso a la vista mínima del cliente? Solo mientras está abierta. */
export function isStopOpen(status: StopStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Abrir la parada la marca vista (solo la primera vez); null = no cambia. */
export function markStopSeen(current: StopStatus): StopStatus | null {
  return current === "ASSIGNED" ? "SEEN" : null;
}

/** Liquidación de la visita con su resultado. */
export function resolveStop(
  current: StopStatus,
  input: {
    outcome: StopOutcome;
    collectedMinor?: number;
    reason?: string;
    promiseDate?: string;
    today: string;
  },
): StopStatus {
  assertOpen(current);
  if (input.outcome !== "PAID" && input.collectedMinor !== undefined) {
    throw new DomainError("Solo una visita con pago lleva monto cobrado");
  }
  switch (input.outcome) {
    case "PAID":
      if (!Number.isInteger(input.collectedMinor) || (input.collectedMinor ?? 0) <= 0) {
        throw new DomainError("Una visita con pago exige el monto cobrado");
      }
      break;
    case "NOT_PAID":
      if ((input.reason ?? "").trim().length < MIN_REASON_LENGTH) {
        throw new DomainError("Si no pagó, indica el motivo");
      }
      break;
    case "PROMISE":
      if (!input.promiseDate || input.promiseDate < input.today) {
        throw new DomainError("La promesa de pago exige una fecha de hoy en adelante");
      }
      break;
    case "NOT_FOUND":
      break;
  }
  return "RESOLVED";
}

/** El coordinador cancela una parada abierta (p. ej. el cliente pagó por PIX), con motivo. */
export function cancelStop(current: StopStatus, reason: string): StopStatus {
  assertOpen(current);
  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw new DomainError("Cancelar una parada exige un motivo");
  }
  return "CANCELLED";
}

/** ¿El resultado cuenta como visita realizada (reagenda por ciclo de mora)? */
export function countsAsVisit(outcome: StopOutcome): boolean {
  return outcome !== "NOT_FOUND";
}

function assertOpen(current: StopStatus): void {
  if (!isStopOpen(current)) {
    throw new ConflictError("La parada ya fue cerrada", "STOP_CLOSED");
  }
}
