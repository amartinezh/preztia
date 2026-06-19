import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { reconcileBalance } from "./bank-reconciliation";

describe("reconcileBalance", () => {
  it("MATCHED cuando el banco coincide con el sistema", () => {
    expect(reconcileBalance(500000, { kind: "available", balanceMinor: 500000 })).toEqual({
      status: "MATCHED",
      bankMinor: 500000,
      differenceMinor: 0,
    });
  });

  it("MISMATCH y reporta la diferencia (bank − system) cuando hay descuadre", () => {
    expect(reconcileBalance(500000, { kind: "available", balanceMinor: 480000 })).toEqual({
      status: "MISMATCH",
      bankMinor: 480000,
      differenceMinor: -20000,
    });
  });

  it("UNAVAILABLE no concluye nada (sin saldo ni diferencia)", () => {
    expect(reconcileBalance(500000, { kind: "unavailable", reason: "sin_credencial" })).toEqual({
      status: "UNAVAILABLE",
      bankMinor: null,
      differenceMinor: null,
    });
  });

  it("rechaza saldos no enteros", () => {
    expect(() => reconcileBalance(1.5, { kind: "available", balanceMinor: 0 })).toThrow(DomainError);
    expect(() => reconcileBalance(0, { kind: "available", balanceMinor: 9.9 })).toThrow(DomainError);
  });
});
