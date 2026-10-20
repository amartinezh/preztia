import { describe, it, expect } from "vitest";
import {
  assertTenantActive,
  isTenantOperating,
  assertValidTenantSlug,
  canTransitionTenant,
  toTenantSlug,
} from "./tenant";
import { DomainError, ForbiddenError } from "../shared/money";

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

describe("assertTenantActive", () => {
  it("un tenant ACTIVE deja operar a sus usuarios", () => {
    expect(() => assertTenantActive("ACTIVE")).not.toThrow();
  });

  it("un tenant inexistente tampoco opera (falla cerrado)", () => {
    expect(isTenantOperating(null)).toBe(false);
    expect(() => assertTenantActive(null)).toThrow(ForbiddenError);
  });

  it("un tenant SUSPENDED bloquea el acceso (403 TENANT_SUSPENDED)", () => {
    expect(isTenantOperating("SUSPENDED")).toBe(false);
    expect(() => assertTenantActive("SUSPENDED")).toThrow(ForbiddenError);
    expect(() => assertTenantActive("SUSPENDED")).toThrow(expect.objectContaining({ code: "TENANT_SUSPENDED" }));
  });
});
