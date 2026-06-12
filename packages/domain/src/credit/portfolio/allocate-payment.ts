// Regla PURA de aplicación de un pago a la cartera: el dinero cae en cascada
// sobre la cuota más antigua (seq ascendente), admite abonos parciales y
// sobrepagos. No conoce BD ni bancos: recibe el estado de las cuotas y devuelve
// el estado resultante junto con las asignaciones auditables.
//
// Invariante central: Σ allocations + overpaymentMinor === payment.amountMinor.

import { DomainError, Money } from "../../shared/money";
import { type PortfolioInstallment, remainingMinor } from "./installment";

/** Asignación de una porción del pago a una cuota concreta (auditable). */
export interface PaymentAllocation {
  readonly installmentId: string;
  readonly amountMinor: number;
}

export interface AllocationResult {
  readonly allocations: readonly PaymentAllocation[];
  /** Estado resultante de TODAS las cuotas (también las no tocadas). */
  readonly installments: readonly PortfolioInstallment[];
  /** Remanente del pago cuando la cartera quedó saldada (saldo a favor). */
  readonly overpaymentMinor: number;
  /** true si tras el abono no queda saldo pendiente en la cartera. */
  readonly creditSettled: boolean;
}

/**
 * Aplica un pago a las cuotas en cascada (la más antigua primero).
 *
 * Invariantes:
 * - `Σ allocations + overpaymentMinor === payment.amountMinor` (no se pierde un centavo).
 * - Por cuota, `paidMinor` nunca supera `amountDueMinor`.
 * - El pago debe ser positivo y de la misma moneda del crédito.
 */
export function allocatePayment(
  creditCurrency: string,
  installments: readonly PortfolioInstallment[],
  payment: Money,
): AllocationResult {
  if (payment.currency !== creditCurrency) {
    throw new DomainError("Moneda distinta");
  }
  if (payment.amountMinor <= 0) {
    throw new DomainError("El pago debe ser mayor a cero");
  }

  const ordered = [...installments].sort((a, b) => a.seq - b.seq);
  const allocations: PaymentAllocation[] = [];
  const updated: PortfolioInstallment[] = [];
  let remainingPayment = payment.amountMinor;

  for (const installment of ordered) {
    const due = remainingMinor(installment);
    if (due === 0 || remainingPayment === 0) {
      updated.push(installment);
      continue;
    }
    const applied = Math.min(due, remainingPayment);
    remainingPayment -= applied;
    const paidMinor = installment.paidMinor + applied;
    updated.push({
      ...installment,
      paidMinor,
      status: paidMinor === installment.amountDueMinor ? "PAID" : "PARTIALLY_PAID",
    });
    allocations.push({ installmentId: installment.id, amountMinor: applied });
  }

  const creditSettled = updated.every((installment) => remainingMinor(installment) === 0);
  return {
    allocations,
    installments: updated,
    overpaymentMinor: remainingPayment,
    creditSettled,
  };
}
