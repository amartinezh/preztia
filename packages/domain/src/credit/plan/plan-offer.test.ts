import { describe, it, expect } from "vitest";
import { ConflictError } from "../../shared/money";
import {
  assertOfferTransition,
  isOfferExpired,
  offerExpiryFrom,
} from "./plan-offer";

describe("assertOfferTransition", () => {
  it("permite ofertar desde NOT_OFFERED hacia selección o aceptación", () => {
    expect(() => assertOfferTransition("NOT_OFFERED", "OFFER", "AWAITING_SELECTION")).not.toThrow();
    expect(() => assertOfferTransition("NOT_OFFERED", "OFFER", "AWAITING_ACCEPTANCE")).not.toThrow();
  });

  it("permite elegir plan y luego aceptar", () => {
    expect(() => assertOfferTransition("AWAITING_SELECTION", "SELECT", "AWAITING_ACCEPTANCE")).not.toThrow();
    expect(() => assertOfferTransition("AWAITING_ACCEPTANCE", "ACCEPT", "ACCEPTED")).not.toThrow();
  });

  it("permite re-ofertar tras un rechazo", () => {
    expect(() => assertOfferTransition("DECLINED", "OFFER", "AWAITING_ACCEPTANCE")).not.toThrow();
  });

  it("rechaza ofertar un expediente ya aceptado", () => {
    expect(() => assertOfferTransition("ACCEPTED", "OFFER", "AWAITING_ACCEPTANCE")).toThrow(ConflictError);
  });

  it("rechaza aceptar antes de ofertar", () => {
    expect(() => assertOfferTransition("NOT_OFFERED", "ACCEPT", "ACCEPTED")).toThrow(ConflictError);
  });
});

describe("isOfferExpired", () => {
  const now = new Date("2026-06-16T12:00:00Z");

  it("no vence sin fecha de vencimiento", () => {
    expect(isOfferExpired(null, now)).toBe(false);
  });

  it("vence cuando el ahora supera el vencimiento", () => {
    expect(isOfferExpired(new Date("2026-06-16T11:59:59Z"), now)).toBe(true);
    expect(isOfferExpired(new Date("2026-06-16T12:00:01Z"), now)).toBe(false);
  });
});

describe("offerExpiryFrom", () => {
  it("suma el TTL en horas (24 = un día)", () => {
    const now = new Date("2026-06-16T12:00:00Z");
    expect(offerExpiryFrom(now, 24).toISOString()).toBe("2026-06-17T12:00:00.000Z");
  });
});
