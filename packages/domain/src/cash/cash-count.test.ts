import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { cashCountResult } from "./cash-count";

describe("cashCountResult", () => {
  it("cuadra cuando el conteo coincide con el sistema", () => {
    expect(cashCountResult(120000, 120000)).toEqual({ differenceMinor: 0, isBalanced: true });
  });

  it("reporta sobrante (diferencia positiva)", () => {
    expect(cashCountResult(120000, 125000)).toEqual({ differenceMinor: 5000, isBalanced: false });
  });

  it("reporta faltante (diferencia negativa)", () => {
    expect(cashCountResult(120000, 118000)).toEqual({ differenceMinor: -2000, isBalanced: false });
  });

  it("admite saldo de sistema negativo (sobregiro encadenado)", () => {
    expect(cashCountResult(-1000, 0)).toEqual({ differenceMinor: 1000, isBalanced: false });
  });

  it("rechaza conteo negativo o montos no enteros", () => {
    expect(() => cashCountResult(0, -1)).toThrow(DomainError);
    expect(() => cashCountResult(0, 10.5)).toThrow(DomainError);
    expect(() => cashCountResult(1.5, 0)).toThrow(DomainError);
  });
});
