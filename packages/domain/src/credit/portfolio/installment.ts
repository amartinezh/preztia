// Cuota de la cartera de un crédito otorgado. Es el agregado sobre el que se
// abonan los pagos: cada cuota conoce cuánto se debe y cuánto se ha pagado.
// Inmutable: toda operación devuelve una nueva instancia.

import { DomainError } from "../../shared/money";

export type InstallmentStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

/** Cuota persistida de la cartera (id de BD + plan + abonos acumulados). */
export interface PortfolioInstallment {
  readonly id: string;
  readonly seq: number;
  /** Fecha de negocio (ISO `YYYY-MM-DD`). */
  readonly dueDate: string;
  readonly amountDueMinor: number;
  readonly paidMinor: number;
  readonly status: InstallmentStatus;
}

/** Saldo pendiente de la cuota; nunca negativo (invariante paid ≤ due). */
export function remainingMinor(installment: PortfolioInstallment): number {
  const remaining = installment.amountDueMinor - installment.paidMinor;
  if (remaining < 0) {
    throw new DomainError("Cuota con abonos por encima de su valor");
  }
  return remaining;
}

/** Una cuota vencida y no saldada pasa a OVERDUE; las pagas no cambian. */
export function markOverdue(installment: PortfolioInstallment, today: string): PortfolioInstallment {
  if (installment.status === "PAID") return installment;
  if (installment.dueDate >= today) return installment;
  return { ...installment, status: "OVERDUE" };
}

/** Saldo total pendiente de la cartera (suma de saldos de cada cuota). */
export function portfolioBalanceMinor(installments: readonly PortfolioInstallment[]): number {
  return installments.reduce((acc, installment) => acc + remainingMinor(installment), 0);
}
