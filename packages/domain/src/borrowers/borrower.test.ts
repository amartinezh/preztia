import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import {
  assertCreditLimitMinor,
  canReceiveCredit,
  CREDIT_DENIED_BLOCKED,
  CREDIT_DENIED_OVER_LIMIT,
  isBorrowerColor,
  normalizeNationalId,
} from "./borrower";

describe("normalizeNationalId", () => {
  it("recorta extremos y colapsa espacios internos", () => {
    expect(normalizeNationalId("  -326 821 252  ")).toBe("-326 821 252");
  });
});

describe("isBorrowerColor", () => {
  it("acepta los colores del catálogo y rechaza el resto", () => {
    expect(isBorrowerColor("RED")).toBe(true);
    expect(isBorrowerColor("NONE")).toBe(true);
    expect(isBorrowerColor("PURPLE")).toBe(false);
  });
});

describe("assertCreditLimitMinor", () => {
  it("acepta enteros no negativos", () => {
    expect(() => assertCreditLimitMinor(70000)).not.toThrow();
    expect(() => assertCreditLimitMinor(0)).not.toThrow();
  });
  it("rechaza negativos y no enteros", () => {
    expect(() => assertCreditLimitMinor(-1)).toThrow(DomainError);
    expect(() => assertCreditLimitMinor(10.5)).toThrow(DomainError);
  });
});

describe("canReceiveCredit", () => {
  const limit = { creditBlocked: false, creditLimitMinor: 70000 };

  it("permite cuando saldo + solicitado no excede el cupo", () => {
    const d = canReceiveCredit(limit, { requestedMinor: 50000, outstandingMinor: 0 });
    expect(d.allowed).toBe(true);
  });

  it("permite justo en el límite (invariante de borde)", () => {
    const d = canReceiveCredit(limit, { requestedMinor: 20000, outstandingMinor: 50000 });
    expect(d.allowed).toBe(true);
  });

  it("niega cuando excede el cupo", () => {
    const d = canReceiveCredit(limit, { requestedMinor: 20001, outstandingMinor: 50000 });
    expect(d).toEqual({ allowed: false, reason: CREDIT_DENIED_OVER_LIMIT });
  });

  it("niega si el cliente está bloqueado, sin importar el cupo", () => {
    const d = canReceiveCredit(
      { creditBlocked: true, creditLimitMinor: 1_000_000 },
      { requestedMinor: 1, outstandingMinor: 0 },
    );
    expect(d).toEqual({ allowed: false, reason: CREDIT_DENIED_BLOCKED });
  });

  it("cupo 0 = sin cupo: permite el crédito sin importar el monto", () => {
    const sinCupo = { creditBlocked: false, creditLimitMinor: 0 };
    const d = canReceiveCredit(sinCupo, { requestedMinor: 90000, outstandingMinor: 0 });
    expect(d.allowed).toBe(true);
  });

  it("cupo 0 = sin cupo: permite un crédito adicional aunque haya saldo vigente", () => {
    const sinCupo = { creditBlocked: false, creditLimitMinor: 0 };
    const d = canReceiveCredit(sinCupo, { requestedMinor: 90000, outstandingMinor: 250000 });
    expect(d.allowed).toBe(true);
  });

  it("cupo 0 sigue negando si el cliente está bloqueado", () => {
    const d = canReceiveCredit(
      { creditBlocked: true, creditLimitMinor: 0 },
      { requestedMinor: 90000, outstandingMinor: 0 },
    );
    expect(d).toEqual({ allowed: false, reason: CREDIT_DENIED_BLOCKED });
  });
});
