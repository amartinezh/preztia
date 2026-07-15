import { describe, it, expect } from "vitest";
import {
  buildAccountBalanceMessage,
  buildAccountMovementsMessage,
  detectAccountInquiry,
} from "./account-inquiry";

describe("detectAccountInquiry", () => {
  it("detecta la consulta de saldo en varias formas", () => {
    for (const text of [
      "¿cuál es mi saldo?",
      "cuanto debo",
      "cuánto le debo?",
      "cuanto me falta por pagar",
      "quiero saber mi deuda",
      "estado de cuenta por favor",
    ]) {
      expect(detectAccountInquiry(text)).toBe("balance");
    }
  });

  it("detecta la consulta de movimiento (listado de pagos)", () => {
    for (const text of [
      "quiero ver el movimiento",
      "muéstrame mis movimientos",
      "el historial de pagos",
      "ver mis pagos",
      "quiero el extracto",
    ]) {
      expect(detectAccountInquiry(text)).toBe("movements");
    }
  });

  it("el movimiento tiene prioridad sobre el saldo cuando aparecen juntos", () => {
    expect(detectAccountInquiry("muéstrame el movimiento y mi saldo")).toBe("movements");
  });

  it("null cuando el mensaje no pide información de cuenta", () => {
    for (const text of ["hola", "quiero pagar", "¿cuál es la tasa?", ""]) {
      expect(detectAccountInquiry(text)).toBeNull();
    }
  });
});

const credit = (over: Partial<import("./account-inquiry").AccountCreditLine> = {}) => ({
  startDate: "2026-07-01",
  totalDueMinor: 12600000,
  totalPaidMinor: 5200000,
  outstandingMinor: 7400000,
  dueTodayMinor: 4200000,
  overdueMinor: 3200000,
  movements: [
    { date: "2026-07-10", amountMinor: 1000000 },
    { date: "2026-07-05", amountMinor: 4200000 },
  ],
  ...over,
});

describe("buildAccountBalanceMessage", () => {
  it("un crédito: muestra total, abonado, lo que falta, lo que debe a la fecha y la mora", () => {
    const msg = buildAccountBalanceMessage({
      firstName: "Ana",
      currency: "COP",
      credits: [credit()],
    });
    expect(msg).toContain("¡Hola Ana!");
    expect(msg).toContain("estado de tu crédito");
    expect(msg).toContain("Valor total del crédito: $ 126.000,00");
    expect(msg).toContain("Has abonado: $ 52.000,00");
    expect(msg).toContain("Te falta por pagar: $ 74.000,00");
    expect(msg).toContain("Debes a la fecha: $ 42.000,00");
    expect(msg).toContain("En mora (atrasado): $ 32.000,00");
  });

  it("un crédito: celebra estar al día cuando no hay mora", () => {
    const msg = buildAccountBalanceMessage({
      firstName: "Ana",
      currency: "COP",
      credits: [credit({ outstandingMinor: 0, dueTodayMinor: 0, overdueMinor: 0 })],
    });
    expect(msg).toContain("estás al día");
    expect(msg).not.toContain("atrasado");
  });

  it("varios créditos: resume cada uno y consolida el total y la mora", () => {
    const msg = buildAccountBalanceMessage({
      firstName: "Ana",
      currency: "COP",
      credits: [
        credit({ startDate: "2026-07-01", totalDueMinor: 12600000, outstandingMinor: 7400000, overdueMinor: 3200000 }),
        credit({ startDate: "2026-07-05", totalDueMinor: 9600000, outstandingMinor: 9600000, overdueMinor: 0, movements: [] }),
      ],
    });
    expect(msg).toContain("Tienes 2 créditos activos");
    expect(msg).toContain("Crédito de $ 126.000,00 · desde 01/07/2026");
    expect(msg).toContain("Crédito de $ 96.000,00 · desde 05/07/2026");
    // Total consolidado = 7.400.000 + 9.600.000 y mora total = 3.200.000 + 0.
    expect(msg).toContain("En total te falta por pagar: $ 170.000,00");
    expect(msg).toContain("En mora (total): $ 32.000,00");
  });
});

describe("buildAccountMovementsMessage", () => {
  it("un crédito: lista los pagos con el saldo pendiente y la mora", () => {
    const msg = buildAccountMovementsMessage({
      firstName: "Ana",
      currency: "COP",
      credits: [credit()],
    });
    expect(msg).toContain("2026-07-10 — $ 10.000,00");
    expect(msg).toContain("2026-07-05 — $ 42.000,00");
    expect(msg).toContain("Te falta por pagar: $ 74.000,00");
    expect(msg).toContain("En mora (atrasado): $ 32.000,00");
  });

  it("un crédito: indica cuando aún no hay pagos", () => {
    const msg = buildAccountMovementsMessage({
      firstName: "Ana",
      currency: "COP",
      credits: [credit({ movements: [], outstandingMinor: 12600000, overdueMinor: 0 })],
    });
    expect(msg).toContain("Aún no registramos pagos");
    expect(msg).toContain("estás al día");
  });

  it("varios créditos: una sección de pagos por crédito", () => {
    const msg = buildAccountMovementsMessage({
      firstName: "Ana",
      currency: "COP",
      credits: [
        credit({ totalDueMinor: 12600000, outstandingMinor: 7400000, overdueMinor: 3200000 }),
        credit({ startDate: "2026-07-05", totalDueMinor: 9600000, outstandingMinor: 9600000, overdueMinor: 0, movements: [] }),
      ],
    });
    expect(msg).toContain("pagos de tus créditos activos");
    expect(msg).toContain("Crédito de $ 126.000,00");
    expect(msg).toContain("2026-07-10 — $ 10.000,00");
    expect(msg).toContain("Crédito de $ 96.000,00");
    expect(msg).toContain("Aún no registramos pagos");
    expect(msg).toContain("Te falta: $ 96.000,00 · 🟢 Al día");
  });
});
