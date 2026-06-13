import { describe, expect, it } from "vitest";
import { can, isZoneInScope } from "./authorization";
import type { SessionClaims } from "./jwt";

const collector: SessionClaims = {
  userId: "u",
  tenantId: "t",
  role: "COLLECTOR",
  zonePaths: ["co.bogota.suba"],
  exp: 0,
};

describe("authorization", () => {
  it("respeta las capacidades por rol", () => {
    expect(can("ADMIN", "zone:manage")).toBe(true);
    expect(can("COORDINATOR", "payment:reconcile")).toBe(true);
    expect(can("COLLECTOR", "payment:reconcile")).toBe(false);
    expect(can("COLLECTOR", "payment:register")).toBe(true);
    expect(can(null, "credit:read")).toBe(false);
  });

  it("acota el alcance de zonas al subárbol asignado", () => {
    expect(isZoneInScope(collector, "co.bogota.suba")).toBe(true);
    expect(isZoneInScope(collector, "co.bogota.suba.ruta01")).toBe(true);
    expect(isZoneInScope(collector, "co.bogota.kennedy")).toBe(false);
    // Evita falsos positivos por prefijo de cadena (suba2 no es hijo de suba).
    expect(isZoneInScope(collector, "co.bogota.suba2")).toBe(false);
  });

  it("ADMIN no está acotado por zonas", () => {
    expect(isZoneInScope({ ...collector, role: "ADMIN" }, "cualquier.zona")).toBe(true);
  });
});
