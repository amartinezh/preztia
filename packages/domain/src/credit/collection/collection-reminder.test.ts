import { describe, it, expect } from "vitest";
import { DomainError } from "../../shared/money";
import type { PortfolioInstallment } from "../portfolio/installment";
import {
  buildCollectionReminderMessage,
  dailyDueMinor,
  formatMoneyMinor,
} from "./collection-reminder";

function inst(p: Partial<PortfolioInstallment>): PortfolioInstallment {
  return {
    id: p.id ?? "i",
    seq: p.seq ?? 1,
    dueDate: p.dueDate ?? "2026-06-20",
    amountDueMinor: p.amountDueMinor ?? 100000,
    paidMinor: p.paidMinor ?? 0,
    status: p.status ?? "PENDING",
  };
}

describe("dailyDueMinor", () => {
  it("suma el saldo de la cuota vigente de hoy más los atrasos no saldados", () => {
    const installments = [
      inst({ seq: 1, dueDate: "2026-06-18", amountDueMinor: 100000, paidMinor: 0 }), // atraso
      inst({ seq: 2, dueDate: "2026-06-19", amountDueMinor: 100000, paidMinor: 40000 }), // atraso parcial → 60000
      inst({ seq: 3, dueDate: "2026-06-20", amountDueMinor: 100000, paidMinor: 0 }), // hoy
      inst({ seq: 4, dueDate: "2026-06-21", amountDueMinor: 100000, paidMinor: 0 }), // futuro: no cuenta
    ];
    expect(dailyDueMinor(installments, "2026-06-20")).toBe(260000);
  });

  it("ignora las cuotas PAGADAS aunque venzan hoy o antes", () => {
    const installments = [
      inst({ seq: 1, dueDate: "2026-06-19", amountDueMinor: 100000, paidMinor: 100000, status: "PAID" }),
      inst({ seq: 2, dueDate: "2026-06-20", amountDueMinor: 100000, paidMinor: 0 }),
    ];
    expect(dailyDueMinor(installments, "2026-06-20")).toBe(100000);
  });

  it("es 0 cuando todo está al día o saldado", () => {
    const installments = [
      inst({ seq: 1, dueDate: "2026-06-19", amountDueMinor: 100000, paidMinor: 100000, status: "PAID" }),
      inst({ seq: 2, dueDate: "2026-06-25", amountDueMinor: 100000, paidMinor: 0 }),
    ];
    expect(dailyDueMinor(installments, "2026-06-20")).toBe(0);
  });
});

describe("formatMoneyMinor", () => {
  it("formatea BRL con miles y centavos al estilo R$", () => {
    expect(formatMoneyMinor(123456, "BRL")).toBe("R$ 1.234,56");
  });
  it("usa el código ISO cuando no hay símbolo conocido", () => {
    expect(formatMoneyMinor(5000, "ARS")).toBe("ARS 50,00");
  });
  it("rechaza montos no enteros (fallo rápido)", () => {
    expect(() => formatMoneyMinor(10.5, "BRL")).toThrow(DomainError);
  });
});

describe("buildCollectionReminderMessage", () => {
  it("incluye nombre, monto, PIX y la invitación a responder con el comprobante", () => {
    const msg = buildCollectionReminderMessage({
      firstName: "Ana",
      dueMinor: 260000,
      currency: "BRL",
      pixKey: "12345678900",
    });
    expect(msg).toContain("¡Hola Ana!");
    expect(msg).toContain("R$ 2.600,00");
    expect(msg).toContain("PIX");
    expect(msg).toContain("12345678900");
    expect(msg).toContain("comprobante");
  });

  it("falla rápido si no hay cuota por cobrar", () => {
    expect(() =>
      buildCollectionReminderMessage({ firstName: "Ana", dueMinor: 0, currency: "BRL", pixKey: "k" }),
    ).toThrow(DomainError);
  });
});
