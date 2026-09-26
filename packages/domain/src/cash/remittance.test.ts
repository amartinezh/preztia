import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../shared/money";
import {
  assertCanSubmitRemittance,
  assessReception,
  buildDebtClosure,
  carriedDebtMinor,
  remittanceObligation,
  summarizeRemittance,
  type RouteBoxMovement,
} from "./remittance";

const BOGOTA = "America/Bogota";

function mv(direction: "IN" | "OUT", kind: RouteBoxMovement["kind"], amountMinor: number): RouteBoxMovement {
  return { direction, kind, amountMinor };
}

describe("summarizeRemittance", () => {
  it("clasifica los movimientos y el esperado = anterior + entradas − salidas", () => {
    const summary = summarizeRemittance(20_000, [
      mv("IN", "PAYMENT_IN", 200_000),
      mv("IN", "PAYMENT_IN", 100_000),
      mv("OUT", "EXPENSE", 15_000),
      mv("OUT", "TRANSFER", 50_000),
      mv("OUT", "DEBT_CLOSURE", 5_000),
      mv("IN", "ADJUSTMENT", 1_000),
    ]);
    expect(summary).toEqual({
      openingMinor: 20_000,
      collectedMinor: 300_000,
      expensesMinor: 15_000,
      transferredOutMinor: 50_000,
      debtClosedMinor: 5_000,
      otherInMinor: 1_000,
      otherOutMinor: 0,
      expectedMinor: 251_000,
    });
  });

  it("sin movimientos el esperado es el saldo anterior", () => {
    expect(summarizeRemittance(7_000, []).expectedMinor).toBe(7_000);
  });
});

describe("remittanceObligation", () => {
  const base = { deadlineHourLocal: 20, timeZone: BOGOTA, hasOpenSubmission: false };
  // 10:00 del 25 en Bogotá (UTC−5) → límite 20:00 del 25 = 01:00 UTC del 26.
  const collectedAt = new Date("2026-09-25T15:00:00Z");

  it("sin cobros en efectivo pendientes está al día (exento)", () => {
    const o = remittanceObligation({ ...base, oldestUnremittedCollectionAt: null, now: new Date() });
    expect(o).toEqual({ status: "UP_TO_DATE", dueAt: null, lateMinutes: 0 });
  });

  it("antes de la hora límite está pendiente", () => {
    const o = remittanceObligation({
      ...base,
      oldestUnremittedCollectionAt: collectedAt,
      now: new Date("2026-09-26T00:30:00Z"), // 19:30 local
    });
    expect(o.status).toBe("PENDING");
    expect(o.dueAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
  });

  it("pasada la hora límite está atrasado y mide el atraso en minutos", () => {
    const o = remittanceObligation({
      ...base,
      oldestUnremittedCollectionAt: collectedAt,
      now: new Date("2026-09-26T03:30:00Z"), // 22:30 local
    });
    expect(o).toMatchObject({ status: "LATE", lateMinutes: 150 });
  });

  it("un cobro hecho después de la hora límite vence al día siguiente", () => {
    const o = remittanceObligation({
      ...base,
      oldestUnremittedCollectionAt: new Date("2026-09-26T02:00:00Z"), // 21:00 local del 25
      now: new Date("2026-09-26T03:00:00Z"),
    });
    expect(o.status).toBe("PENDING");
    expect(o.dueAt?.toISOString()).toBe("2026-09-27T01:00:00.000Z");
  });

  it("con una rendición declarada espera recepción y no cuenta atraso", () => {
    const o = remittanceObligation({
      ...base,
      hasOpenSubmission: true,
      oldestUnremittedCollectionAt: collectedAt,
      now: new Date("2026-09-27T00:00:00Z"),
    });
    expect(o).toEqual({ status: "AWAITING_RECEPTION", dueAt: null, lateMinutes: 0 });
  });
});

describe("assertCanSubmitRemittance", () => {
  const ok = { hasOpenSubmission: false, hasUnremittedCollections: true, balanceMinor: 1000, declaredMinor: 1000 };

  it("permite declarar si hay cobros sin rendir o efectivo en poder", () => {
    expect(() => assertCanSubmitRemittance(ok)).not.toThrow();
    expect(() => assertCanSubmitRemittance({ ...ok, hasUnremittedCollections: false })).not.toThrow();
  });

  it("rechaza una segunda declaración abierta", () => {
    expect(() => assertCanSubmitRemittance({ ...ok, hasOpenSubmission: true })).toThrow(ConflictError);
  });

  it("rechaza declarar sin nada que rendir", () => {
    try {
      assertCanSubmitRemittance({ ...ok, hasUnremittedCollections: false, balanceMinor: 0, declaredMinor: 0 });
      throw new Error("debió fallar");
    } catch (err) {
      expect((err as ConflictError).code).toBe("NOTHING_TO_REMIT");
    }
  });

  it("el monto declarado es un entero no negativo", () => {
    expect(() => assertCanSubmitRemittance({ ...ok, declaredMinor: -1 })).toThrow(DomainError);
    expect(() => assertCanSubmitRemittance({ ...ok, declaredMinor: 1.5 })).toThrow(DomainError);
  });
});

describe("assessReception", () => {
  it("el faltante es esperado − contado (invariante esperado = contado + faltante)", () => {
    expect(assessReception({ expectedMinor: 320_000, countedMinor: 300_000 })).toEqual({ shortfallMinor: 20_000 });
    expect(assessReception({ expectedMinor: 320_000, countedMinor: 320_000 })).toEqual({ shortfallMinor: 0 });
    expect(assessReception({ expectedMinor: 320_000, countedMinor: 0 })).toEqual({ shortfallMinor: 320_000 });
  });

  it("no se recibe más de lo esperado", () => {
    try {
      assessReception({ expectedMinor: 100, countedMinor: 101 });
      throw new Error("debió fallar");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).code).toBe("COUNT_EXCEEDS_EXPECTED");
    }
  });

  it("el conteo es un entero no negativo", () => {
    expect(() => assessReception({ expectedMinor: 100, countedMinor: -1 })).toThrow(DomainError);
  });
});

describe("carriedDebtMinor", () => {
  it("es el saldo al corte menos los cierres posteriores, nunca negativo", () => {
    expect(carriedDebtMinor(20_000, 0)).toBe(20_000);
    expect(carriedDebtMinor(20_000, 5_000)).toBe(15_000);
    expect(carriedDebtMinor(20_000, 25_000)).toBe(0);
  });
});

describe("buildDebtClosure", () => {
  const ok = { debtMinor: 20_000, amountMinor: 20_000, type: "PAYROLL" as const, reason: "Nómina sept.", remittanceInProgress: false };

  it("produce un asiento OUT DEBT_CLOSURE por el monto", () => {
    expect(buildDebtClosure(ok)).toEqual({
      direction: "OUT",
      kind: "DEBT_CLOSURE",
      amountMinor: 20_000,
      reason: "Nómina sept.",
    });
  });

  it("exige motivo y un monto positivo", () => {
    expect(() => buildDebtClosure({ ...ok, reason: "  " })).toThrow(DomainError);
    expect(() => buildDebtClosure({ ...ok, amountMinor: 0 })).toThrow(DomainError);
  });

  it("no cierra más de la deuda arrastrada", () => {
    expect(() => buildDebtClosure({ ...ok, amountMinor: 20_001 })).toThrow(ConflictError);
  });

  it("no se cierra deuda con una rendición en curso", () => {
    expect(() => buildDebtClosure({ ...ok, remittanceInProgress: true })).toThrow(ConflictError);
  });
});
