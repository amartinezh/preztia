import { describe, it, expect } from "vitest";
import { DomainError } from "../../shared/money";
import { principalRecoveredMinor, splitAllocations } from "./principal-interest-split";

// Crédito de 1.000 al 20% → total 1.200 (proporción capital 5/6).
const TERMS = { principalMinor: 1000, totalDueMinor: 1200 };

function alloc(installmentId: string, amountMinor: number) {
  return { installmentId, amountMinor };
}

describe("principalRecoveredMinor", () => {
  it("es cero sin pagos y el capital completo al pagar el total", () => {
    expect(principalRecoveredMinor(TERMS, 0)).toBe(0);
    expect(principalRecoveredMinor(TERMS, 1200)).toBe(1000);
  });

  it("es proporcional y redondea hacia abajo", () => {
    expect(principalRecoveredMinor(TERMS, 600)).toBe(500);
    expect(principalRecoveredMinor(TERMS, 1)).toBe(0); // 5/6 → 0
    expect(principalRecoveredMinor(TERMS, 7)).toBe(5); // 35/6 = 5,83 → 5
  });

  it("no pierde precisión con montos grandes (producto > 2^53)", () => {
    // 50.000.000 COP en centavos, al 20%: el producto intermedio supera Number.MAX_SAFE_INTEGER.
    const big = { principalMinor: 5_000_000_000, totalDueMinor: 6_000_000_000 };
    expect(principalRecoveredMinor(big, 3_000_000_000)).toBe(2_500_000_000);
    expect(principalRecoveredMinor(big, 6_000_000_000)).toBe(5_000_000_000);
  });

  it("sin interés todo lo pagado es capital", () => {
    expect(principalRecoveredMinor({ principalMinor: 500, totalDueMinor: 500 }, 321)).toBe(321);
  });
});

describe("splitAllocations", () => {
  it("desglosa cada abono: capital + interés = abono", () => {
    const [split] = splitAllocations(TERMS, 0, [alloc("c1", 600)]);
    expect(split).toEqual({ installmentId: "c1", amountMinor: 600, principalMinor: 500, interestMinor: 100 });
  });

  it("al pagar el total, Σ capital = principal y Σ interés = total − principal exactamente", () => {
    // Abonos de montos "feos" que no dividen exacto la proporción.
    const payments = [7, 13, 101, 333, 1, 745];
    let paid = 0;
    let principal = 0;
    let interest = 0;
    for (const amount of payments) {
      for (const s of splitAllocations(TERMS, paid, [alloc("c", amount)])) {
        expect(s.principalMinor + s.interestMinor).toBe(s.amountMinor);
        expect(s.principalMinor).toBeGreaterThanOrEqual(0);
        expect(s.interestMinor).toBeGreaterThanOrEqual(0);
        principal += s.principalMinor;
        interest += s.interestMinor;
      }
      paid += amount;
    }
    expect(paid).toBe(1200);
    expect(principal).toBe(1000);
    expect(interest).toBe(200);
  });

  it("un abono repartido en varias cuotas telescopea igual que un abono único", () => {
    const split = splitAllocations(TERMS, 100, [alloc("c1", 150), alloc("c2", 250)]);
    const total = split.reduce((acc, s) => acc + s.principalMinor, 0);
    expect(total).toBe(principalRecoveredMinor(TERMS, 500) - principalRecoveredMinor(TERMS, 100));
  });

  it("sin asignaciones devuelve lista vacía", () => {
    expect(splitAllocations(TERMS, 0, [])).toEqual([]);
  });

  it("falla rápido ante términos o montos inválidos", () => {
    expect(() => splitAllocations({ principalMinor: 0, totalDueMinor: 100 }, 0, [])).toThrow(DomainError);
    expect(() => splitAllocations({ principalMinor: 200, totalDueMinor: 100 }, 0, [])).toThrow(DomainError);
    expect(() => splitAllocations(TERMS, -1, [])).toThrow(DomainError);
    expect(() => splitAllocations(TERMS, 0, [alloc("c", 0)])).toThrow(DomainError);
    expect(() => splitAllocations(TERMS, 0, [alloc("c", 1.5)])).toThrow(DomainError);
  });

  it("rechaza abonar por encima del total del crédito", () => {
    expect(() => splitAllocations(TERMS, 1100, [alloc("c", 101)])).toThrow(DomainError);
  });
});
