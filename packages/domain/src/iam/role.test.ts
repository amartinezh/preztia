import { describe, it, expect } from "vitest";
import { can, canCreateRole, creatableRoles, isControlPlane, ROLES } from "./role";

describe("can", () => {
  it("SUPER_ADMIN solo gobierna el plano de control (tenants/admins)", () => {
    expect(can("SUPER_ADMIN", "tenant:manage")).toBe(true);
    expect(can("SUPER_ADMIN", "tenant-admin:manage")).toBe(true);
    // No opera el plano de datos del tenant
    expect(can("SUPER_ADMIN", "user:manage")).toBe(false);
    expect(can("SUPER_ADMIN", "credit:create")).toBe(false);
  });

  it("ADMIN gobierna todo su tenant pero no la plataforma", () => {
    expect(can("ADMIN", "user:manage")).toBe(true);
    expect(can("ADMIN", "zone:manage")).toBe(true);
    expect(can("ADMIN", "application:review")).toBe(true);
    expect(can("ADMIN", "tenant:manage")).toBe(false);
  });

  it("COORDINATOR opera y crea cobradores, sin administrar el tenant", () => {
    expect(can("COORDINATOR", "collector:manage")).toBe(true);
    expect(can("COORDINATOR", "client:assign")).toBe(true);
    expect(can("COORDINATOR", "payment:reconcile")).toBe(true);
    expect(can("COORDINATOR", "user:manage")).toBe(false);
    expect(can("COORDINATOR", "zone:manage")).toBe(false);
  });

  it("COLLECTOR solo ve y cobra sus clientes", () => {
    expect(can("COLLECTOR", "client:read")).toBe(true);
    expect(can("COLLECTOR", "payment:register")).toBe(true);
    expect(can("COLLECTOR", "credit:read")).toBe(true);
    expect(can("COLLECTOR", "credit:create")).toBe(false);
    expect(can("COLLECTOR", "collector:manage")).toBe(false);
  });

  it("rol nulo/indefinido no tiene capacidades", () => {
    expect(can(null, "credit:read")).toBe(false);
    expect(can(undefined, "credit:read")).toBe(false);
  });
});

describe("isControlPlane", () => {
  it("solo SUPER_ADMIN es plano de control", () => {
    expect(isControlPlane("SUPER_ADMIN")).toBe(true);
    for (const role of ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(isControlPlane(role)).toBe(false);
    }
  });
});

describe("jerarquía de provisión", () => {
  it("SUPER_ADMIN crea ADMIN; ADMIN crea coordinadores/cobradores; COORDINATOR crea cobradores", () => {
    expect(canCreateRole("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(canCreateRole("ADMIN", "COORDINATOR")).toBe(true);
    expect(canCreateRole("ADMIN", "COLLECTOR")).toBe(true);
    expect(canCreateRole("COORDINATOR", "COLLECTOR")).toBe(true);
  });

  it("nadie escala privilegios al crear usuarios", () => {
    expect(canCreateRole("COORDINATOR", "COORDINATOR")).toBe(false);
    expect(canCreateRole("COORDINATOR", "ADMIN")).toBe(false);
    expect(canCreateRole("ADMIN", "ADMIN")).toBe(false);
    expect(canCreateRole("ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(creatableRoles("COLLECTOR")).toHaveLength(0);
  });
});
