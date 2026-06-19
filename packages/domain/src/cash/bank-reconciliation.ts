// Dominio puro de la CONCILIACIÓN BANCARIA en línea: compara el saldo del sistema con
// el saldo real traído del banco y clasifica el resultado. Sin I/O: el veredicto del
// banco entra ya resuelto por el puerto de infraestructura.

import { DomainError } from "../shared/money";

/** Veredicto del proveedor de saldo bancario (resuelto por el adaptador del banco). */
export type BankBalanceVerdict =
  /** El banco devolvió un saldo real. */
  | { readonly kind: "available"; readonly balanceMinor: number }
  /** El banco no respondió / sin credencial: no se concluye nada. */
  | { readonly kind: "unavailable"; readonly reason: string };

export type BankSyncStatus = "MATCHED" | "MISMATCH" | "UNAVAILABLE";

export interface BankReconciliationResult {
  readonly status: BankSyncStatus;
  /** Saldo real del banco; null si UNAVAILABLE. */
  readonly bankMinor: number | null;
  /** bank − system; null si UNAVAILABLE. */
  readonly differenceMinor: number | null;
}

/**
 * Concilia el saldo del sistema (Σ asientos) contra el saldo real del banco.
 *  - unavailable → UNAVAILABLE (no consume conclusión; la UI no marca descuadre).
 *  - available y diferencia 0 → MATCHED.
 *  - available y diferencia ≠ 0 → MISMATCH (la UI lo resalta para investigar).
 */
export function reconcileBalance(
  systemMinor: number,
  verdict: BankBalanceVerdict,
): BankReconciliationResult {
  if (!Number.isInteger(systemMinor)) {
    throw new DomainError("El saldo del sistema debe ser un entero en unidades menores");
  }

  if (verdict.kind === "unavailable") {
    return { status: "UNAVAILABLE", bankMinor: null, differenceMinor: null };
  }

  if (!Number.isInteger(verdict.balanceMinor)) {
    throw new DomainError("El saldo del banco debe ser un entero en unidades menores");
  }

  const differenceMinor = verdict.balanceMinor - systemMinor;
  return {
    status: differenceMinor === 0 ? "MATCHED" : "MISMATCH",
    bankMinor: verdict.balanceMinor,
    differenceMinor,
  };
}
