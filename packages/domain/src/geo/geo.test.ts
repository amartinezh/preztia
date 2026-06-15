import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { assertCoordinate } from "./coordinate";
import { classifyBorrowerPosition } from "../borrowers/position";

describe("assertCoordinate", () => {
  it("acepta coordenadas válidas", () => {
    expect(() => assertCoordinate(-19.92, -43.94)).not.toThrow(); // Belo Horizonte
    expect(() => assertCoordinate(0, 0)).not.toThrow();
  });
  it("rechaza fuera de rango o no finitas", () => {
    expect(() => assertCoordinate(91, 0)).toThrow(DomainError);
    expect(() => assertCoordinate(0, 181)).toThrow(DomainError);
    expect(() => assertCoordinate(Number.NaN, 0)).toThrow(DomainError);
  });
});

describe("classifyBorrowerPosition", () => {
  it("sin créditos → NO_CREDIT", () => {
    expect(classifyBorrowerPosition({ hasCredits: false, anyOverdue: false })).toBe("NO_CREDIT");
  });
  it("con crédito y atraso → OVERDUE", () => {
    expect(classifyBorrowerPosition({ hasCredits: true, anyOverdue: true })).toBe("OVERDUE");
  });
  it("con crédito al día → CURRENT", () => {
    expect(classifyBorrowerPosition({ hasCredits: true, anyOverdue: false })).toBe("CURRENT");
  });
});
