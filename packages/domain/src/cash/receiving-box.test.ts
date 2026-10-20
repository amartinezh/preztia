import { describe, it, expect } from "vitest";
import { ConflictError, DomainError, ForbiddenError } from "../shared/money";
import {
  assertCanReceivePaymentInto,
  resolveReceivingBox,
  type CandidateReceivingBox,
} from "./receiving-box";

const OFFICE: CandidateReceivingBox = { type: "CASH", assignedTo: null, active: true, zonePath: "mg" };

describe("resolveReceivingBox", () => {
  it("el cobrador recibe en su caja de ruta", () => {
    expect(resolveReceivingBox({ actorRole: "COLLECTOR", requestedCashBoxId: null })).toEqual({ kind: "ROUTE_BOX" });
  });

  it("el cobrador no puede elegir otra caja (403)", () => {
    expect(() => resolveReceivingBox({ actorRole: "COLLECTOR", requestedCashBoxId: "box-1" })).toThrow(ForbiddenError);
  });

  it("el ADMIN y el coordinador eligen la caja que recibe", () => {
    expect(resolveReceivingBox({ actorRole: "ADMIN", requestedCashBoxId: "box-1" })).toEqual({ kind: "CHOSEN_BOX", cashBoxId: "box-1" });
    expect(resolveReceivingBox({ actorRole: "COORDINATOR", requestedCashBoxId: "box-2" })).toEqual({ kind: "CHOSEN_BOX", cashBoxId: "box-2" });
  });

  it("sin caja elegida, quien no es cobrador no puede registrar (sin caja por defecto)", () => {
    const run = () => resolveReceivingBox({ actorRole: "ADMIN", requestedCashBoxId: null });
    expect(run).toThrow(DomainError);
    expect(run).toThrow(expect.objectContaining({ code: "RECEIVING_BOX_REQUIRED" }));
  });
});

describe("assertCanReceivePaymentInto", () => {
  it("acepta una caja de oficina o una cuenta bancaria de la zona, de un ancestro o del tenant", () => {
    expect(() => assertCanReceivePaymentInto({ creditZonePath: "mg.div", box: OFFICE })).not.toThrow();
    expect(() => assertCanReceivePaymentInto({ creditZonePath: "mg.div", box: { ...OFFICE, type: "BANK", zonePath: null } })).not.toThrow();
  });

  it("rechaza la caja de ruta de un cobrador (le descuadraría la rendición)", () => {
    expect(() =>
      assertCanReceivePaymentInto({ creditZonePath: "mg.div", box: { ...OFFICE, assignedTo: "collector-1" } }),
    ).toThrow(expect.objectContaining({ code: "INVALID_RECEIVING_BOX" }));
  });

  it("rechaza Tránsito (solo para lo no identificado) y las cajas inactivas", () => {
    expect(() => assertCanReceivePaymentInto({ creditZonePath: "mg", box: { ...OFFICE, type: "TRANSIT", zonePath: null } })).toThrow(ConflictError);
    expect(() => assertCanReceivePaymentInto({ creditZonePath: "mg", box: { ...OFFICE, active: false } })).toThrow(
      expect.objectContaining({ code: "RECEIVING_BOX_INACTIVE" }),
    );
  });

  it("rechaza una caja de otra rama de zonas", () => {
    expect(() => assertCanReceivePaymentInto({ creditZonePath: "sp.cps", box: OFFICE })).toThrow(
      expect.objectContaining({ code: "BOX_NOT_USABLE_BY_ZONE" }),
    );
  });
});
