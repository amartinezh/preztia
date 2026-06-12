import { describe, it, expect } from "vitest";
import { decideReconciliation } from "./reconciliation";

const MAX = 5;

describe("decideReconciliation", () => {
  it("banco confirma: verificar y abonar el monto bancario", () => {
    const decision = decideReconciliation({
      bank: { status: "confirmed", bankAmountMinor: 25000, bankPaidAt: null },
      attempts: 3,
      maxAttempts: MAX,
    });
    expect(decision).toEqual({ kind: "verify_and_allocate", amountMinor: 25000 });
  });

  it("banco caído: sigue pendiente sin consumir el veredicto", () => {
    const decision = decideReconciliation({
      bank: { status: "unavailable", reason: "timeout" },
      attempts: MAX + 3, // ni siquiera con muchos intentos se acusa fraude
      maxAttempts: MAX,
    });
    expect(decision.kind).toBe("keep_pending");
  });

  it("not_found con intentos restantes: sigue pendiente", () => {
    const decision = decideReconciliation({ bank: { status: "not_found" }, attempts: 2, maxAttempts: MAX });
    expect(decision.kind).toBe("keep_pending");
  });

  it("not_found agotando intentos: se marca sospecha de fraude", () => {
    const decision = decideReconciliation({
      bank: { status: "not_found" },
      attempts: MAX - 1, // el intento actual es el que agota
      maxAttempts: MAX,
    });
    expect(decision.kind).toBe("flag_suspected_fraud");
  });
});
