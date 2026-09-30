import { describe, it, expect } from "vitest";
import { ForbiddenError } from "../../shared/money";
import { canChoosePaymentDate, resolvePaymentDate, type PaymentDateContext } from "./payment-date";

// Bogotá es UTC−5: "ahora" = martes 2026-09-29 10:00 local.
const NOW = new Date("2026-09-29T15:00:00.000Z");
const TZ = "America/Bogota";
const ctx = (overrides: Partial<PaymentDateContext> = {}): PaymentDateContext => ({
  policy: { locked: true, maxDaysBack: 3 },
  actorRole: "COLLECTOR",
  now: NOW,
  timeZone: TZ,
  sealedUntil: null,
  ...overrides,
});
const offline = (iso: string) => ({ kind: "OFFLINE_CAPTURE" as const, capturedAt: new Date(iso) });
const manual = (paidOn: string) => ({ kind: "MANUAL" as const, paidOn });

describe("resolvePaymentDate — sin fecha pedida", () => {
  it("el pago es de ahora y no es atrasado", () => {
    expect(resolvePaymentDate(null, ctx())).toEqual({ paidAt: NOW, backdated: false, adjusted: null });
  });
});

describe("resolvePaymentDate — captura offline (automática, cualquier rol)", () => {
  it("usa la hora real capturada por el dispositivo aunque el bloqueo esté encendido", () => {
    const r = resolvePaymentDate(offline("2026-09-28T22:30:00.000Z"), ctx());
    expect(r).toEqual({ paidAt: new Date("2026-09-28T22:30:00.000Z"), backdated: true, adjusted: null });
  });

  it("límite exacto: el primer instante del día más antiguo permitido (3 días) pasa", () => {
    // 2026-09-26 00:00 local = 05:00Z
    expect(resolvePaymentDate(offline("2026-09-26T05:00:00.000Z"), ctx()).adjusted).toBeNull();
  });

  it("más antigua que el límite: NO se pierde, se registra con la hora actual y se marca TOO_OLD", () => {
    // 2026-09-25 23:59 local
    const r = resolvePaymentDate(offline("2026-09-26T04:59:00.000Z"), ctx());
    expect(r).toEqual({ paidAt: NOW, backdated: false, adjusted: "TOO_OLD" });
  });

  it("dentro de un período ya sellado: hora actual y SEALED (la foto no cambia)", () => {
    const r = resolvePaymentDate(offline("2026-09-28T04:00:00.000Z"), ctx({ sealedUntil: new Date("2026-09-28T05:00:00.000Z") }));
    expect(r.adjusted).toBe("SEALED");
    expect(r.paidAt).toEqual(NOW);
  });

  it("reloj del teléfono adelantado (futuro): hora actual y FUTURE", () => {
    expect(resolvePaymentDate(offline("2026-09-29T16:00:00.000Z"), ctx()).adjusted).toBe("FUTURE");
  });

  it("con límite 0 solo vale lo capturado hoy", () => {
    expect(resolvePaymentDate(offline("2026-09-29T05:10:00.000Z"), ctx({ policy: { locked: true, maxDaysBack: 0 } })).adjusted).toBeNull();
    expect(resolvePaymentDate(offline("2026-09-29T04:50:00.000Z"), ctx({ policy: { locked: true, maxDaysBack: 0 } })).adjusted).toBe("TOO_OLD");
  });
});

describe("resolvePaymentDate — fecha elegida a mano", () => {
  it("el ADMIN fecha ayer: queda a mediodía local de ese día y marcado como atrasado", () => {
    const r = resolvePaymentDate(manual("2026-09-28"), ctx({ actorRole: "ADMIN" }));
    expect(r).toEqual({ paidAt: new Date("2026-09-28T17:00:00.000Z"), backdated: true, adjusted: null });
  });

  it("elegir hoy es ahora (no atrasado)", () => {
    expect(resolvePaymentDate(manual("2026-09-29"), ctx({ actorRole: "ADMIN" }))).toEqual({ paidAt: NOW, backdated: false, adjusted: null });
  });

  it("con el bloqueo, el coordinador no puede (403 BACKDATE_LOCKED); sin bloqueo, sí", () => {
    const run = () => resolvePaymentDate(manual("2026-09-28"), ctx({ actorRole: "COORDINATOR" }));
    expect(run).toThrow(ForbiddenError);
    expect(run).toThrow(expect.objectContaining({ code: "BACKDATE_LOCKED" }));
    expect(
      resolvePaymentDate(manual("2026-09-28"), ctx({ actorRole: "COORDINATOR", policy: { locked: false, maxDaysBack: 3 } })).backdated,
    ).toBe(true);
  });

  it("el cobrador nunca elige la fecha a mano (ni con el bloqueo apagado)", () => {
    expect(() => resolvePaymentDate(manual("2026-09-28"), ctx({ policy: { locked: false, maxDaysBack: 3 } }))).toThrow(ForbiddenError);
  });

  it("fuera de regla se rechaza explicando por qué: futuro, demasiado antiguo o período sellado", () => {
    const admin = (overrides: Partial<PaymentDateContext> = {}) => ctx({ actorRole: "ADMIN", ...overrides });
    expect(() => resolvePaymentDate(manual("2026-09-30"), admin())).toThrow(expect.objectContaining({ code: "PAYMENT_DATE_IN_FUTURE" }));
    expect(() => resolvePaymentDate(manual("2026-09-25"), admin())).toThrow(expect.objectContaining({ code: "PAYMENT_DATE_TOO_OLD" }));
    expect(() => resolvePaymentDate(manual("2026-09-26"), admin())).not.toThrow();
    expect(() =>
      resolvePaymentDate(manual("2026-09-27"), admin({ sealedUntil: new Date("2026-09-28T05:00:00.000Z") })),
    ).toThrow(expect.objectContaining({ code: "PAYMENT_DATE_SEALED" }));
  });
});

describe("canChoosePaymentDate", () => {
  it("ADMIN siempre; coordinador solo sin bloqueo; cobrador nunca", () => {
    const locked = { locked: true, maxDaysBack: 3 };
    const open = { locked: false, maxDaysBack: 3 };
    expect(canChoosePaymentDate(locked, "ADMIN")).toBe(true);
    expect(canChoosePaymentDate(locked, "COORDINATOR")).toBe(false);
    expect(canChoosePaymentDate(open, "COORDINATOR")).toBe(true);
    expect(canChoosePaymentDate(open, "COLLECTOR")).toBe(false);
  });
});
