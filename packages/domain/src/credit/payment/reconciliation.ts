// Regla PURA de conciliación bancaria: decide el destino de un pago que quedó
// UNVERIFIED cuando el proceso batch lo reconsulta contra el banco recaudador.
//
// `unavailable` nunca consume intentos (la caída es nuestra o del banco, no del
// cliente); `not_found` sí: agotados los intentos, el pago se marca como
// sospecha de fraude para revisión del analista.

import type { BankVerification } from "./payment-review";

export type ReconciliationDecision =
  /** El banco confirmó: verificar el pago y abonar el monto bancario. */
  | { readonly kind: "verify_and_allocate"; readonly amountMinor: number }
  /** Sin señal concluyente: sigue pendiente para el próximo ciclo. */
  | { readonly kind: "keep_pending" }
  /** El banco no encuentra la transacción tras agotar intentos: escalar. */
  | { readonly kind: "flag_suspected_fraud"; readonly reasons: readonly string[] };

export function decideReconciliation(input: {
  readonly bank: BankVerification;
  /** Intentos de conciliación YA realizados (sin contar el actual). */
  readonly attempts: number;
  readonly maxAttempts: number;
}): ReconciliationDecision {
  if (input.bank.status === "confirmed") {
    return { kind: "verify_and_allocate", amountMinor: input.bank.bankAmountMinor };
  }

  if (input.bank.status === "unavailable") return { kind: "keep_pending" };

  // not_found: el intento actual cuenta.
  const attempt = input.attempts + 1;
  if (attempt < input.maxAttempts) return { kind: "keep_pending" };
  return {
    kind: "flag_suspected_fraud",
    reasons: [`El banco no encontró la transacción tras ${attempt} intentos de conciliación`],
  };
}
