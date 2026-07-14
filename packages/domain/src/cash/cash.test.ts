import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { assertExpenseAmountMinor, decideExpense } from "./expense";

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
