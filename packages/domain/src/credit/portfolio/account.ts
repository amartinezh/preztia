// Lectura derivada (read-model puro) de una CUENTA = un crédito otorgado visto desde su
// cartera de cuotas: deuda, cuotas pagas, días de atraso y valor de cuota. Espeja las columnas
// del "Listado de Cuentas" y la cabecera del "Detalle de préstamo" del sistema legado. Sin I/O.

import { DomainError } from "../../shared/money";
import { type PortfolioInstallment, remainingMinor } from "./installment";

const MILLIS_PER_DAY = 86_400_000;

export interface AccountSummary {
  /** Valor total a pagar (capital + interés) = Σ amountDueMinor. */
  readonly totalDueMinor: number;
  /** Total abonado = Σ paidMinor. */
  readonly totalPaidMinor: number;
  /** Deuda vigente = total a pagar − abonado (nunca negativa). */
  readonly outstandingMinor: number;
  /** Cuotas totalmente pagadas ("Cts Pagas"). */
  readonly paidCount: number;
  /** Número total de cuotas. */
  readonly totalCount: number;
}

/** Resume la cartera de un crédito en los agregados del listado de cuentas. */
export function summarizeAccount(
  installments: readonly PortfolioInstallment[],
): AccountSummary {
  let totalDueMinor = 0;
  let totalPaidMinor = 0;
  let paidCount = 0;
  for (const installment of installments) {
    totalDueMinor += installment.amountDueMinor;
    totalPaidMinor += installment.paidMinor;
    if (remainingMinor(installment) === 0) paidCount += 1;
  }
  return {
    totalDueMinor,
    totalPaidMinor,
    outstandingMinor: totalDueMinor - totalPaidMinor,
    paidCount,
    totalCount: installments.length,
  };
}

/**
 * Días de atraso del crédito: días transcurridos desde la cuota impaga más antigua que ya
 * venció hasta `today`. 0 si la cuenta está al día (sin cuotas vencidas con saldo). Coherente
 * con `markOverdue` (una cuota vence cuando `dueDate < today`). Aritmética en UTC.
 */
export function daysOverdue(
  installments: readonly PortfolioInstallment[],
  today: string,
): number {
  const todayMs = toUtcMillis(today);
  let earliestOverdueMs: number | null = null;
  for (const installment of installments) {
    if (remainingMinor(installment) === 0) continue;
    const dueMs = toUtcMillis(installment.dueDate);
    if (dueMs < todayMs && (earliestOverdueMs === null || dueMs < earliestOverdueMs)) {
      earliestOverdueMs = dueMs;
    }
  }
  if (earliestOverdueMs === null) return 0;
  return Math.floor((todayMs - earliestOverdueMs) / MILLIS_PER_DAY);
}

/**
 * Saldo EN MORA a una fecha: suma del saldo pendiente de las cuotas ya vencidas (vencimiento
 * ESTRICTAMENTE anterior a `today`) que no están saldadas. Coherente con `markOverdue` (una cuota
 * entra en mora cuando `dueDate < today`; la que vence hoy aún no está en mora). Reusa el
 * invariante `remainingMinor` (abonos ≤ valor), por lo que nunca es negativo. 0 si está al día.
 */
export function overdueBalanceMinor(
  installments: readonly PortfolioInstallment[],
  today: string,
): number {
  return installments
    .filter((installment) => installment.dueDate < today)
    .reduce((total, installment) => total + remainingMinor(installment), 0);
}

/**
 * Monto que la cuenta debe pagar en una fecha dada ("Pago en Fecha" del legado): saldo
 * pendiente de las cuotas cuyo vencimiento es exactamente `date`. 0 si no vence nada ese día.
 */
export function dueOnDateMinor(
  installments: readonly PortfolioInstallment[],
  date: string,
): number {
  let total = 0;
  for (const installment of installments) {
    if (installment.dueDate === date) total += remainingMinor(installment);
  }
  return total;
}

function toUtcMillis(isoDate: string): number {
  const ms = new Date(`${isoDate}T00:00:00Z`).getTime();
  if (Number.isNaN(ms)) throw new DomainError("Fecha inválida");
  return ms;
}
