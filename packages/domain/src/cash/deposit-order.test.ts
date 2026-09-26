import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../shared/money";
import {
  assertCanIssueDeposit,
  cancelOrder,
  disputeDeposit,
  markSeen,
  rankDepositMatches,
  reportDeposit,
  verifyDeposit,
} from "./deposit-order";

const NOW = new Date("2026-09-26T20:00:00Z");

function expectConflict(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error("debió fallar");
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe(code);
  }
}

describe("assertCanIssueDeposit", () => {
  it("permite ordenar hasta el efectivo en poder del cobrador", () => {
    expect(() => assertCanIssueDeposit({ amountMinor: 300_000, cashInHandMinor: 300_000 })).not.toThrow();
  });

  it("no se ordena más que el efectivo en su poder", () => {
    expectConflict(() => assertCanIssueDeposit({ amountMinor: 300_001, cashInHandMinor: 300_000 }), "DEPOSIT_EXCEEDS_CASH");
  });

  it("el monto es un entero positivo", () => {
    expect(() => assertCanIssueDeposit({ amountMinor: 0, cashInHandMinor: 10 })).toThrow(DomainError);
    expect(() => assertCanIssueDeposit({ amountMinor: 1.5, cashInHandMinor: 10 })).toThrow(DomainError);
  });
});

describe("máquina de estados de la orden", () => {
  it("abrirla la marca vista una sola vez", () => {
    expect(markSeen("ISSUED")).toBe("SEEN");
    expect(markSeen("SEEN")).toBeNull();
    expect(markSeen("REPORTED")).toBeNull();
  });

  it("se reporta desde emitida, vista u objetada", () => {
    for (const from of ["ISSUED", "SEEN", "DISPUTED"] as const) {
      expect(reportDeposit(from, { amountMinor: 100, depositedAt: NOW, now: NOW })).toBe("REPORTED");
    }
    expectConflict(() => reportDeposit("VERIFIED", { amountMinor: 100, depositedAt: NOW, now: NOW }), "INVALID_ORDER_TRANSITION");
  });

  it("el reporte no puede tener fecha futura ni monto inválido", () => {
    const tomorrow = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    expect(() => reportDeposit("SEEN", { amountMinor: 100, depositedAt: tomorrow, now: NOW })).toThrow(DomainError);
    expect(() => reportDeposit("SEEN", { amountMinor: 0, depositedAt: NOW, now: NOW })).toThrow(DomainError);
  });

  it("solo se verifica u objeta lo reportado", () => {
    expect(verifyDeposit("REPORTED", { verifiedAmountMinor: 100 })).toBe("VERIFIED");
    expect(disputeDeposit("REPORTED", "Ilegible")).toBe("DISPUTED");
    expectConflict(() => verifyDeposit("SEEN", { verifiedAmountMinor: 100 }), "INVALID_ORDER_TRANSITION");
    expectConflict(() => disputeDeposit("VERIFIED", "x".repeat(5)), "INVALID_ORDER_TRANSITION");
  });

  it("objetar y cancelar exigen motivo", () => {
    expect(() => disputeDeposit("REPORTED", " ")).toThrow(DomainError);
    expect(() => cancelOrder("ISSUED", "")).toThrow(DomainError);
  });

  it("se cancela antes de verificar, nunca después ni reportada", () => {
    for (const from of ["ISSUED", "SEEN", "DISPUTED"] as const) {
      expect(cancelOrder(from, "Ya no hace falta")).toBe("CANCELLED");
    }
    expectConflict(() => cancelOrder("VERIFIED", "Tarde"), "INVALID_ORDER_TRANSITION");
    expectConflict(() => cancelOrder("REPORTED", "Hay que revisar primero"), "INVALID_ORDER_TRANSITION");
  });
});

describe("rankDepositMatches", () => {
  const depositedAt = new Date("2026-09-26T15:20:00Z");
  const hours = (h: number) => new Date(depositedAt.getTime() + h * 3_600_000);

  it("propone solo ingresos del monto exacto dentro de la ventana, del más cercano al más lejano", () => {
    const ranked = rankDepositMatches({ amountMinor: 250_000, depositedAt }, [
      { id: "lejos", amountMinor: 250_000, receivedAt: hours(20) },
      { id: "otro-monto", amountMinor: 249_999, receivedAt: hours(0) },
      { id: "cerca", amountMinor: 250_000, receivedAt: hours(1) },
      { id: "fuera", amountMinor: 250_000, receivedAt: hours(-30) },
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["cerca", "lejos"]);
  });
});
