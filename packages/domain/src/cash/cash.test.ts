import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { computeCajaActual } from "./settlement";
import { assertExpenseAmountMinor, decideExpense } from "./expense";

describe("computeCajaActual", () => {
  it("encadena el saldo: anterior + cobrado − prestado − gastos", () => {
    expect(
      computeCajaActual({
        cajaAnteriorMinor: 241300,
        totalCobradoMinor: 2398400,
        totalPrestadoMinor: 2140000,
        gastosMinor: 143500,
      }),
    ).toBe(356200);
  });

  it("permite saldo negativo (sobregiro real)", () => {
    expect(
      computeCajaActual({
        cajaAnteriorMinor: 0,
        totalCobradoMinor: 100,
        totalPrestadoMinor: 500,
        gastosMinor: 0,
      }),
    ).toBe(-400);
  });

  it("permite caja anterior negativa (saldo encadenado en sobregiro)", () => {
    expect(
      computeCajaActual({ cajaAnteriorMinor: -70000, totalCobradoMinor: 0, totalPrestadoMinor: 0, gastosMinor: 0 }),
    ).toBe(-70000);
  });

  it("rechaza flujos negativos y montos no enteros", () => {
    expect(() =>
      computeCajaActual({ cajaAnteriorMinor: 0, totalCobradoMinor: -1, totalPrestadoMinor: 0, gastosMinor: 0 }),
    ).toThrow(DomainError);
    expect(() =>
      computeCajaActual({ cajaAnteriorMinor: 1.5, totalCobradoMinor: 0, totalPrestadoMinor: 0, gastosMinor: 0 }),
    ).toThrow(DomainError);
  });
});

describe("expense", () => {
  it("acepta montos positivos y rechaza cero/negativos/no enteros", () => {
    expect(() => assertExpenseAmountMinor(8000)).not.toThrow();
    expect(() => assertExpenseAmountMinor(0)).toThrow(DomainError);
    expect(() => assertExpenseAmountMinor(-5)).toThrow(DomainError);
    expect(() => assertExpenseAmountMinor(1.2)).toThrow(DomainError);
  });

  it("solo un gasto PENDING puede revisarse", () => {
    expect(decideExpense("PENDING", true)).toBe("APPROVED");
    expect(decideExpense("PENDING", false)).toBe("REJECTED");
    expect(() => decideExpense("APPROVED", true)).toThrow(DomainError);
    expect(() => decideExpense("REJECTED", false)).toThrow(DomainError);
  });
});
