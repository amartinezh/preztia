import { describe, it, expect } from "vitest";
import { ConflictError } from "../../shared/money";
import { assertInterestAllowed, canUseCustomInterest, type InterestPolicy } from "./interest-policy";

const FREE: InterestPolicy = { locked: false, adminCustomAllowed: true };
const LOCKED_ADMIN_EXCEPTION: InterestPolicy = { locked: true, adminCustomAllowed: true };
const LOCKED_NO_EXCEPTION: InterestPolicy = { locked: true, adminCustomAllowed: false };
const PLAN_20 = { interestPct: 200, isActive: true };

const check = (policy: InterestPolicy, actorRole: "ADMIN" | "COORDINATOR", requestedInterestPct: number, plan: typeof PLAN_20 | null) =>
  () => assertInterestAllowed({ policy, actorRole, requestedInterestPct, plan });

describe("assertInterestAllowed — bloqueo apagado", () => {
  it("cualquier interés, con o sin plan, para cualquier rol (comportamiento libre)", () => {
    expect(check(FREE, "COORDINATOR", 350, null)).not.toThrow();
    expect(check(FREE, "COORDINATOR", 350, PLAN_20)).not.toThrow();
    expect(check(FREE, "COORDINATOR", 200, { interestPct: 200, isActive: false })).not.toThrow();
  });
});

describe("assertInterestAllowed — bloqueo encendido", () => {
  it("el interés exacto de un plan activo pasa, para coordinador y ADMIN", () => {
    for (const policy of [LOCKED_ADMIN_EXCEPTION, LOCKED_NO_EXCEPTION]) {
      expect(check(policy, "COORDINATOR", 200, PLAN_20)).not.toThrow();
      expect(check(policy, "ADMIN", 200, PLAN_20)).not.toThrow();
    }
  });

  it("alterar el interés de un plan (incluso una décima) es 409 INTEREST_LOCKED, también para el ADMIN", () => {
    for (const requested of [199, 201, 0]) {
      expect(check(LOCKED_ADMIN_EXCEPTION, "COORDINATOR", requested, PLAN_20)).toThrow(
        expect.objectContaining({ code: "INTEREST_LOCKED" }),
      );
      expect(check(LOCKED_ADMIN_EXCEPTION, "ADMIN", requested, PLAN_20)).toThrow(ConflictError);
    }
  });

  it("el mensaje dice cuál es el interés del plan", () => {
    expect(check(LOCKED_NO_EXCEPTION, "COORDINATOR", 250, PLAN_20)).toThrow("20 %");
  });

  it("un plan inactivo no sirve de fuente del interés (409 PLAN_INACTIVE)", () => {
    expect(check(LOCKED_ADMIN_EXCEPTION, "ADMIN", 200, { interestPct: 200, isActive: false })).toThrow(
      expect.objectContaining({ code: "PLAN_INACTIVE" }),
    );
  });

  it("'Personalizado': el coordinador nunca; el ADMIN solo con la excepción permitida", () => {
    expect(check(LOCKED_ADMIN_EXCEPTION, "COORDINATOR", 200, null)).toThrow(expect.objectContaining({ code: "INTEREST_LOCKED" }));
    expect(check(LOCKED_ADMIN_EXCEPTION, "ADMIN", 350, null)).not.toThrow();
    expect(check(LOCKED_NO_EXCEPTION, "ADMIN", 350, null)).toThrow(expect.objectContaining({ code: "INTEREST_LOCKED" }));
  });
});

describe("canUseCustomInterest", () => {
  it("resume quién ve la opción 'Personalizado'", () => {
    expect(canUseCustomInterest(FREE, "COORDINATOR")).toBe(true);
    expect(canUseCustomInterest(LOCKED_ADMIN_EXCEPTION, "ADMIN")).toBe(true);
    expect(canUseCustomInterest(LOCKED_ADMIN_EXCEPTION, "COORDINATOR")).toBe(false);
    expect(canUseCustomInterest(LOCKED_NO_EXCEPTION, "ADMIN")).toBe(false);
  });
});
