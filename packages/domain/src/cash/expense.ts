// Dominio puro del GASTO de cobro ("Solicitud Gastos" del legado): el cobrador solicita, el
// socio/coordinador aprueba o rechaza (maker-checker). Solo los gastos APROBADOS afectan la caja.

import { DomainError } from "../shared/money";

export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED";

/** El gasto debe ser un entero positivo en unidades menores. */
export function assertExpenseAmountMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new DomainError("El gasto debe ser un entero positivo en unidades menores");
  }
}

/**
 * Resuelve la revisión de un gasto. Solo un gasto PENDING puede revisarse (transición única,
 * sin reaprobaciones que descuadren la caja). Devuelve el nuevo estado.
 */
export function decideExpense(current: ExpenseStatus, approve: boolean): ExpenseStatus {
  if (current !== "PENDING") {
    throw new DomainError("El gasto ya fue revisado");
  }
  return approve ? "APPROVED" : "REJECTED";
}
