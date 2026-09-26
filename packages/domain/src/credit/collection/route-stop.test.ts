import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../../shared/money";
import {
  assertDispatchable,
  cancelStop,
  isStopOpen,
  markStopSeen,
  overdueAmountMinor,
  resolveStop,
} from "./route-stop";

const TODAY = "2026-09-26";

describe("overdueAmountMinor (monto a cobrar en la visita)", () => {
  it("suma lo pendiente de las cuotas vencidas, sin las que vencen hoy o después", () => {
    expect(
      overdueAmountMinor(
        [
          { dueDate: "2026-09-20", amountDueMinor: 10_000, paidMinor: 4_000 },
          { dueDate: "2026-09-25", amountDueMinor: 10_000, paidMinor: 0 },
          { dueDate: TODAY, amountDueMinor: 10_000, paidMinor: 0 },
          { dueDate: "2026-09-19", amountDueMinor: 10_000, paidMinor: 10_000 },
        ],
        TODAY,
      ),
    ).toBe(16_000);
  });

  it("sin mora es cero", () => {
    expect(overdueAmountMinor([], TODAY)).toBe(0);
  });
});

describe("assertDispatchable", () => {
  it("exige paradas, sin clientes repetidos", () => {
    expect(() => assertDispatchable([])).toThrow(DomainError);
    expect(() =>
      assertDispatchable([
        { creditId: "a", collectorId: "x" },
        { creditId: "a", collectorId: "y" },
      ]),
    ).toThrow(DomainError);
    expect(() =>
      assertDispatchable([
        { creditId: "a", collectorId: "x" },
        { creditId: "b", collectorId: "y" },
      ]),
    ).not.toThrow();
  });
});

describe("estado de la parada", () => {
  it("solo las paradas abiertas dan acceso a la vista mínima", () => {
    expect(isStopOpen("ASSIGNED")).toBe(true);
    expect(isStopOpen("SEEN")).toBe(true);
    expect(isStopOpen("RESOLVED")).toBe(false);
    expect(isStopOpen("CANCELLED")).toBe(false);
  });

  it("abrirla la marca vista una sola vez", () => {
    expect(markStopSeen("ASSIGNED")).toBe("SEEN");
    expect(markStopSeen("SEEN")).toBeNull();
  });

  it("una parada cerrada no se liquida ni se cancela", () => {
    const paid = { outcome: "PAID" as const, collectedMinor: 100, today: TODAY };
    expect(() => resolveStop("RESOLVED", paid)).toThrow(ConflictError);
    expect(() => cancelStop("CANCELLED", "motivo")).toThrow(ConflictError);
  });
});

describe("resolveStop", () => {
  it("PAGÓ exige un monto positivo", () => {
    expect(resolveStop("SEEN", { outcome: "PAID", collectedMinor: 50_000, today: TODAY })).toBe("RESOLVED");
    expect(() => resolveStop("SEEN", { outcome: "PAID", today: TODAY })).toThrow(DomainError);
    expect(() => resolveStop("SEEN", { outcome: "PAID", collectedMinor: 0, today: TODAY })).toThrow(DomainError);
  });

  it("NO PAGÓ exige motivo", () => {
    expect(() => resolveStop("ASSIGNED", { outcome: "NOT_PAID", today: TODAY })).toThrow(DomainError);
    expect(resolveStop("ASSIGNED", { outcome: "NOT_PAID", reason: "Sin dinero hoy", today: TODAY })).toBe("RESOLVED");
  });

  it("PROMESA exige una fecha de hoy en adelante", () => {
    expect(() => resolveStop("SEEN", { outcome: "PROMISE", today: TODAY })).toThrow(DomainError);
    expect(() => resolveStop("SEEN", { outcome: "PROMISE", promiseDate: "2026-09-25", today: TODAY })).toThrow(
      DomainError,
    );
    expect(resolveStop("SEEN", { outcome: "PROMISE", promiseDate: "2026-09-28", today: TODAY })).toBe("RESOLVED");
  });

  it("NO ENCONTRADO no exige nada más", () => {
    expect(resolveStop("SEEN", { outcome: "NOT_FOUND", today: TODAY })).toBe("RESOLVED");
  });

  it("solo PAGÓ lleva monto", () => {
    expect(() =>
      resolveStop("SEEN", { outcome: "NOT_FOUND", collectedMinor: 100, today: TODAY }),
    ).toThrow(DomainError);
  });
});

describe("cancelStop", () => {
  it("cancela una parada abierta con motivo", () => {
    expect(cancelStop("ASSIGNED", "Cliente pagó por PIX")).toBe("CANCELLED");
    expect(() => cancelStop("SEEN", " ")).toThrow(DomainError);
  });
});
