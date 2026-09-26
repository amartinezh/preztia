// Regla PURA de desglose de un abono en CAPITAL e INTERÉS. Con interés plano, cada peso
// pagado lleva capital e interés en la misma proporción del crédito (capital / total).
//
// Se calcula sobre lo ACUMULADO y no abono por abono: el capital recuperado tras haber
// pagado `p` es ⌊p × capital / total⌋, y el capital de un abono es la diferencia entre
// el acumulado después y antes. Así el redondeo nunca se acumula:
//
// Invariantes:
// - Por asignación: capital + interés = monto, ambos ≥ 0.
// - Al pagar el total: Σ capital = principal y Σ interés = total − principal, exactos.

import { DomainError } from "../../shared/money";
import { type PaymentAllocation } from "./allocate-payment";

/** Términos del crédito que fijan la proporción capital/interés. */
export interface RepaymentTerms {
  readonly principalMinor: number;
  /** Σ de lo que se debe pagar (capital + interés) = Σ amount_due de las cuotas. */
  readonly totalDueMinor: number;
}

/** Asignación de un abono a una cuota con su desglose. */
export interface AllocationSplit extends PaymentAllocation {
  readonly principalMinor: number;
  readonly interestMinor: number;
}

/**
 * Capital recuperado después de haber pagado `paidMinor` del total. Usa BigInt porque el
 * producto intermedio (pagado × capital) supera 2^53 con montos reales en centavos.
 */
export function principalRecoveredMinor(terms: RepaymentTerms, paidMinor: number): number {
  assertTerms(terms);
  assertNonNegativeInteger(paidMinor, "El monto pagado");
  if (paidMinor > terms.totalDueMinor) {
    throw new DomainError("Lo pagado supera el total del crédito");
  }
  const recovered =
    (BigInt(paidMinor) * BigInt(terms.principalMinor)) / BigInt(terms.totalDueMinor);
  return Number(recovered);
}

/**
 * Desglosa las asignaciones de UN pago (en el orden en que se aplicaron) sabiendo cuánto
 * se había pagado del crédito antes de él.
 */
export function splitAllocations(
  terms: RepaymentTerms,
  paidBeforeMinor: number,
  allocations: readonly PaymentAllocation[],
): AllocationSplit[] {
  assertTerms(terms);
  assertNonNegativeInteger(paidBeforeMinor, "El monto pagado previo");

  const splits: AllocationSplit[] = [];
  let paid = paidBeforeMinor;
  let recovered = principalRecoveredMinor(terms, paid);
  for (const allocation of allocations) {
    if (!Number.isInteger(allocation.amountMinor) || allocation.amountMinor <= 0) {
      throw new DomainError("Cada asignación debe ser un entero positivo");
    }
    paid += allocation.amountMinor;
    const recoveredAfter = principalRecoveredMinor(terms, paid);
    const principalMinor = recoveredAfter - recovered;
    splits.push({
      ...allocation,
      principalMinor,
      interestMinor: allocation.amountMinor - principalMinor,
    });
    recovered = recoveredAfter;
  }
  return splits;
}

function assertTerms(terms: RepaymentTerms): void {
  if (!Number.isInteger(terms.principalMinor) || terms.principalMinor <= 0) {
    throw new DomainError("El capital del crédito debe ser un entero positivo");
  }
  if (!Number.isInteger(terms.totalDueMinor) || terms.totalDueMinor < terms.principalMinor) {
    throw new DomainError("El total a pagar no puede ser menor que el capital");
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(`${label} debe ser un entero no negativo`);
  }
}
