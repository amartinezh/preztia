// Dominio puro de la ORDEN DE CONSIGNACIÓN al cobrador (sin I/O).
//
// El coordinador ve efectivo acumulado en la caja de ruta de un cobrador y le ordena depositar un
// monto en una cuenta PIX. El cobrador reporta (monto, fecha/hora, comprobante) y el coordinador
// verifica contra el banco u objeta. Cada paso queda en una bitácora append-only: es la
// herramienta de comunicación para cuadres y malentendidos.
//
// Invariantes:
// - no se ordena más que el efectivo en poder del cobrador;
// - solo lo REPORTADO se verifica u objeta; una orden verificada o cancelada es final;
// - objetar y cancelar exigen motivo; un reporte no tiene fecha futura.

import { ConflictError, DomainError } from "../shared/money";

export type FieldOrderStatus = "ISSUED" | "SEEN" | "REPORTED" | "DISPUTED" | "VERIFIED" | "CANCELLED";

const MIN_REASON_LENGTH = 3;
// Tolerancia al reloj del celular: un reporte puede venir con la hora del dispositivo un poco
// adelantada, pero no de un depósito "futuro".
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
// Ventana en la que un ingreso bancario puede corresponder al depósito reportado (el banco puede
// acreditar con horas de diferencia, pero no antes de un día).
const MATCH_WINDOW_BEFORE_MS = 24 * 60 * 60 * 1000;
const MATCH_WINDOW_AFTER_MS = 48 * 60 * 60 * 1000;

/** Guarda al emitir: monto entero positivo y no mayor al efectivo en poder del cobrador. */
export function assertCanIssueDeposit(input: { amountMinor: number; cashInHandMinor: number }): void {
  assertPositiveInteger(input.amountMinor, "El monto a consignar");
  if (input.amountMinor > input.cashInHandMinor) {
    throw new ConflictError(
      "El monto supera el efectivo en poder del cobrador",
      "DEPOSIT_EXCEEDS_CASH",
    );
  }
}

/** Abrir la orden la marca como vista (solo la primera vez); null = no cambia de estado. */
export function markSeen(current: FieldOrderStatus): FieldOrderStatus | null {
  return current === "ISSUED" ? "SEEN" : null;
}

/** El cobrador reporta el depósito (también tras una objeción, para corregir). */
export function reportDeposit(
  current: FieldOrderStatus,
  input: { amountMinor: number; depositedAt: Date; now: Date },
): FieldOrderStatus {
  assertFrom(current, ["ISSUED", "SEEN", "DISPUTED"]);
  assertPositiveInteger(input.amountMinor, "El monto depositado");
  if (input.depositedAt.getTime() - input.now.getTime() > FUTURE_TOLERANCE_MS) {
    throw new DomainError("La fecha del depósito no puede estar en el futuro");
  }
  return "REPORTED";
}

/** El coordinador verifica el depósito reportado (el dinero pasa de la caja de ruta al banco). */
export function verifyDeposit(
  current: FieldOrderStatus,
  input: { verifiedAmountMinor: number },
): FieldOrderStatus {
  assertFrom(current, ["REPORTED"]);
  assertPositiveInteger(input.verifiedAmountMinor, "El monto verificado");
  return "VERIFIED";
}

/** El coordinador objeta el reporte; el cobrador puede reportar de nuevo. */
export function disputeDeposit(current: FieldOrderStatus, reason: string): FieldOrderStatus {
  assertFrom(current, ["REPORTED"]);
  assertReason(reason, "Objetar un reporte exige un motivo");
  return "DISPUTED";
}

/** Cancelar la orden antes de que haya un reporte pendiente o una verificación. */
export function cancelOrder(current: FieldOrderStatus, reason: string): FieldOrderStatus {
  assertFrom(current, ["ISSUED", "SEEN", "DISPUTED"]);
  assertReason(reason, "Cancelar una orden exige un motivo");
  return "CANCELLED";
}

/** Ingreso bancario candidato (traído por la sincronización del banco). */
export interface BankCreditCandidate {
  readonly id: string;
  readonly amountMinor: number;
  readonly receivedAt: Date;
}

/**
 * Sugerencias de ingresos bancarios que pueden ser el depósito: monto EXACTO dentro de la ventana,
 * del más cercano al más lejano a la hora reportada. El coordinador confirma; nunca es automático.
 */
export function rankDepositMatches<T extends BankCreditCandidate>(
  order: { amountMinor: number; depositedAt: Date },
  candidates: readonly T[],
): T[] {
  const reported = order.depositedAt.getTime();
  const distance = (c: T) => Math.abs(c.receivedAt.getTime() - reported);
  return candidates
    .filter((c) => c.amountMinor === order.amountMinor)
    .filter((c) => {
      const delta = c.receivedAt.getTime() - reported;
      return delta >= -MATCH_WINDOW_BEFORE_MS && delta <= MATCH_WINDOW_AFTER_MS;
    })
    .sort((a, b) => distance(a) - distance(b));
}

function assertFrom(current: FieldOrderStatus, allowed: readonly FieldOrderStatus[]): void {
  if (!allowed.includes(current)) {
    throw new ConflictError(
      `La orden está en estado ${current}: la acción no aplica`,
      "INVALID_ORDER_TRANSITION",
    );
  }
}

function assertReason(reason: string, message: string): void {
  if (reason.trim().length < MIN_REASON_LENGTH) throw new DomainError(message);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(`${label} debe ser un entero positivo`);
  }
}
