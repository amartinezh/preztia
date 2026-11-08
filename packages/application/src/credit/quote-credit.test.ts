import { describe, it, expect } from "vitest";
import { DomainError, Money } from "@preztiaos/domain";

import { quoteCredit } from "./quote-credit";

const BASE = {
  principalMinor: 100_000,
  currency: "COP",
  interestPct: 200, // 20 % en base-mil
  installmentsCount: 20,
  startDate: "2026-01-30",
};

describe("quoteCredit", () => {
  it("INVARIANTE: Σ cuotas = total y total = capital con interés (sin perder centavos)", () => {
    const quote = quoteCredit(BASE);
    const sum = quote.installments.reduce((acc, i) => acc + i.amountDueMinor, 0);
    expect(sum).toBe(quote.totalDueMinor);
    expect(quote.totalDueMinor).toBe(Money.of(100_000, "COP").applyInterest(200).amountMinor);
    expect(quote.totalDueMinor).toBe(120_000);
    expect(quote.installments).toHaveLength(20);
  });

  it("INVARIANTE: interés = total − capital; sin interés el interés es cero", () => {
    expect(quoteCredit(BASE).interestMinor).toBe(20_000);
    const free = quoteCredit({ ...BASE, interestPct: 0 });
    expect(free.interestMinor).toBe(0);
    expect(free.totalDueMinor).toBe(BASE.principalMinor);
  });

  it("la última cuota absorbe el redondeo; la cuota representativa es la primera", () => {
    const quote = quoteCredit({ ...BASE, interestPct: 0, installmentsCount: 3 });
    expect(quote.installments.map((i) => i.amountDueMinor)).toEqual([33_333, 33_333, 33_334]);
    expect(quote.installmentValueMinor).toBe(33_333);
    expect(quote.lastInstallmentMinor).toBe(33_334);
  });

  it("una sola cuota: primera = última = total", () => {
    const quote = quoteCredit({ ...BASE, installmentsCount: 1 });
    expect(quote.installmentValueMinor).toBe(120_000);
    expect(quote.lastInstallmentMinor).toBe(120_000);
    expect(quote.firstDueDate).toBe(quote.endDate);
  });

  it("DAILY (por defecto): vence cada día desde el siguiente al desembolso, cruzando fin de mes", () => {
    const quote = quoteCredit({ ...BASE, installmentsCount: 3 });
    expect(quote.installments.map((i) => i.dueDate)).toEqual(["2026-01-31", "2026-02-01", "2026-02-02"]);
    expect(quote.firstDueDate).toBe("2026-01-31");
    expect(quote.endDate).toBe("2026-02-02");
  });

  it("WEEKLY y BIWEEKLY: cada 7 y 14 días", () => {
    const weekly = quoteCredit({ ...BASE, frequency: "WEEKLY", installmentsCount: 2 });
    expect(weekly.installments.map((i) => i.dueDate)).toEqual(["2026-02-06", "2026-02-13"]);
    const biweekly = quoteCredit({ ...BASE, frequency: "BIWEEKLY", installmentsCount: 2 });
    expect(biweekly.installments.map((i) => i.dueDate)).toEqual(["2026-02-13", "2026-02-27"]);
  });

  it("MONTHLY: mismo día de cada mes siguiente", () => {
    const monthly = quoteCredit({ ...BASE, frequency: "MONTHLY", installmentsCount: 3, startDate: "2026-01-15" });
    expect(monthly.installments.map((i) => i.dueDate)).toEqual(["2026-02-15", "2026-03-15", "2026-04-15"]);
    expect(monthly.endDate).toBe("2026-04-15");
  });

  it("las cuotas van numeradas 1..n en orden", () => {
    const quote = quoteCredit({ ...BASE, installmentsCount: 4 });
    expect(quote.installments.map((i) => i.seq)).toEqual([1, 2, 3, 4]);
  });

  it("falla rápido con entradas inválidas (capital no entero, fecha inválida)", () => {
    expect(() => quoteCredit({ ...BASE, principalMinor: 10.5 })).toThrow(DomainError);
    expect(() => quoteCredit({ ...BASE, startDate: "no-es-fecha" })).toThrow(DomainError);
  });
});
