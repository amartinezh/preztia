import { describe, it, expect } from "vitest";
import {
  assertValidTenantSlug,
  canTransitionTenant,
  toTenantSlug,
} from "./tenant";
import { DomainError } from "../shared/money";

describe("assertValidTenantSlug", () => {
  it("acepta slugs minúsculas/dígitos/guiones internos", () => {
    expect(() => assertValidTenantSlug("acme")).not.toThrow();
    expect(() => assertValidTenantSlug("acme-microcreditos-2")).not.toThrow();
  });

  it("rechaza mayúsculas, guiones al borde, vacío y muy cortos", () => {
    expect(() => assertValidTenantSlug("Acme")).toThrow(DomainError);
    expect(() => assertValidTenantSlug("-acme")).toThrow(DomainError);
    expect(() => assertValidTenantSlug("acme-")).toThrow(DomainError);
    expect(() => assertValidTenantSlug("a")).toThrow(DomainError);
    expect(() => assertValidTenantSlug("")).toThrow(DomainError);
  });
});

describe("toTenantSlug", () => {
  it("deriva un slug válido desde un nombre legible", () => {
    expect(toTenantSlug("Acme Microcréditos")).toBe("acme-microcreditos");
  });

  it("falla rápido cuando el nombre no produce slug válido", () => {
    expect(() => toTenantSlug("$")).toThrow(DomainError);
  });
});

describe("canTransitionTenant", () => {
  it("permite ACTIVE↔SUSPENDED y la idempotencia", () => {
    expect(canTransitionTenant("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionTenant("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionTenant("ACTIVE", "ACTIVE")).toBe(true);
  });
});
