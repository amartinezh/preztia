// Dominio puro del ARQUEO de caja: compara el conteo físico contra el saldo del sistema.

import { DomainError } from "../shared/money";

export interface CashCountResult {
  /** counted − system (positivo = sobrante; negativo = faltante). */
  readonly differenceMinor: number;
  /** true si no hay descuadre. */
  readonly isBalanced: boolean;
}

/**
 * Resuelve un arqueo. `systemMinor` es el saldo derivado (Σ asientos); `countedMinor`
 * el conteo físico (no negativo). La diferencia se reporta tal cual: nunca se enmascara
 * un descuadre.
 */
export function cashCountResult(systemMinor: number, countedMinor: number): CashCountResult {
  if (!Number.isInteger(systemMinor)) {
    throw new DomainError("El saldo del sistema debe ser un entero en unidades menores");
  }
  if (!Number.isInteger(countedMinor) || countedMinor < 0) {
    throw new DomainError("El conteo físico debe ser un entero no negativo en unidades menores");
  }
  const differenceMinor = countedMinor - systemMinor;
  return { differenceMinor, isBalanced: differenceMinor === 0 };
}
