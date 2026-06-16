import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../../shared/money";
import {
  assertValidPlanShape,
  assertDefaultIsActive,
  assertCanReleaseDefault,
  shouldBecomeDefaultOnCreate,
  MAX_PLAN_INSTALLMENTS,
} from "./payment-plan";

describe("assertValidPlanShape", () => {
  it("acepta una forma válida (plan a 20 días, 20%)", () => {
    expect(() => assertValidPlanShape({ installmentsCount: 20, interestPct: 200 })).not.toThrow();
  });

  it("rechaza cuotas no enteras, cero o por encima del máximo", () => {
    expect(() => assertValidPlanShape({ installmentsCount: 0, interestPct: 200 })).toThrow(DomainError);
    expect(() => assertValidPlanShape({ installmentsCount: 1.5, interestPct: 200 })).toThrow(DomainError);
    expect(() =>
      assertValidPlanShape({ installmentsCount: MAX_PLAN_INSTALLMENTS + 1, interestPct: 200 }),
    ).toThrow(DomainError);
  });

  it("rechaza interés fuera de [0, 1000] base-mil", () => {
    expect(() => assertValidPlanShape({ installmentsCount: 20, interestPct: -1 })).toThrow(DomainError);
    expect(() => assertValidPlanShape({ installmentsCount: 20, interestPct: 1001 })).toThrow(DomainError);
  });
});

describe("assertDefaultIsActive", () => {
  it("permite un default activo y un no-default inactivo", () => {
    expect(() => assertDefaultIsActive({ isActive: true, isDefault: true })).not.toThrow();
    expect(() => assertDefaultIsActive({ isActive: false, isDefault: false })).not.toThrow();
  });

  it("rechaza un default inactivo", () => {
    expect(() => assertDefaultIsActive({ isActive: false, isDefault: true })).toThrow(DomainError);
  });
});

describe("assertCanReleaseDefault (siempre ≥ 1 default por tenant)", () => {
  it("bloquea liberar el único default", () => {
    expect(() => assertCanReleaseDefault({ isDefault: true }, 1)).toThrow(ConflictError);
  });

  it("permite liberar un default cuando hay otro", () => {
    expect(() => assertCanReleaseDefault({ isDefault: true }, 2)).not.toThrow();
  });

  it("no aplica a planes que no son default", () => {
    expect(() => assertCanReleaseDefault({ isDefault: false }, 1)).not.toThrow();
  });
});

describe("shouldBecomeDefaultOnCreate", () => {
  it("el primer plan del tenant queda por defecto aunque no se pida", () => {
    expect(shouldBecomeDefaultOnCreate(false, 0)).toBe(true);
  });

  it("respeta la marca explícita cuando ya hay defaults", () => {
    expect(shouldBecomeDefaultOnCreate(true, 1)).toBe(true);
    expect(shouldBecomeDefaultOnCreate(false, 1)).toBe(false);
  });
});
