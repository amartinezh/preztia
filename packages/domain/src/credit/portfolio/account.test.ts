import { describe, it, expect } from "vitest";
import type { PortfolioInstallment } from "./installment";
import { daysOverdue, dueOnDateMinor, overdueBalanceMinor, summarizeAccount } from "./account";

function inst(
  seq: number,
  dueDate: string,
  amountDueMinor: number,
  paidMinor: number,
): PortfolioInstallment {
  const status =
    paidMinor === 0 ? "PENDING" : paidMinor >= amountDueMinor ? "PAID" : "PARTIALLY_PAID";
  return { id: `i${seq}`, seq, dueDate, amountDueMinor, paidMinor, status };
}

describe("summarizeAccount", () => {
  it("suma deuda, abonos y cuenta cuotas pagas", () => {
    const s = summarizeAccount([
      inst(1, "2026-06-01", 4200, 4200),
      inst(2, "2026-06-02", 4200, 1000),
      inst(3, "2026-06-03", 4200, 0),
    ]);
    expect(s.totalDueMinor).toBe(12600);
    expect(s.totalPaidMinor).toBe(5200);
    expect(s.outstandingMinor).toBe(7400);
    expect(s.paidCount).toBe(1);
    expect(s.totalCount).toBe(3);
  });

  it("cartera vacía es cuenta saldada en cero", () => {
    expect(summarizeAccount([])).toEqual({
      totalDueMinor: 0,
      totalPaidMinor: 0,
      outstandingMinor: 0,
      paidCount: 0,
      totalCount: 0,
    });
  });
});

describe("daysOverdue", () => {
  const today = "2026-06-10";

  it("0 cuando todas las cuotas vencidas están pagas", () => {
    const list = [inst(1, "2026-06-01", 4200, 4200), inst(2, "2026-06-12", 4200, 0)];
    expect(daysOverdue(list, today)).toBe(0);
  });

  it("cuenta desde la cuota impaga más antigua ya vencida", () => {
    const list = [
      inst(1, "2026-06-05", 4200, 0), // vencida hace 5 días
      inst(2, "2026-06-08", 4200, 0),
    ];
    expect(daysOverdue(list, today)).toBe(5);
  });

  it("una cuota que vence hoy aún no está en atraso (borde)", () => {
    expect(daysOverdue([inst(1, today, 4200, 0)], today)).toBe(0);
  });

  it("una cuota parcial vencida sí cuenta atraso", () => {
    expect(daysOverdue([inst(1, "2026-06-07", 4200, 1000)], today)).toBe(3);
  });
});

describe("overdueBalanceMinor", () => {
  const today = "2026-06-10";

  it("suma el saldo de las cuotas vencidas antes de hoy", () => {
    const list = [
      inst(1, "2026-06-05", 4200, 1000), // vencida, saldo 3200
      inst(2, "2026-06-08", 4200, 0), // vencida, saldo 4200
      inst(3, "2026-06-12", 4200, 0), // futura, no cuenta
    ];
    expect(overdueBalanceMinor(list, today)).toBe(7400);
  });

  it("la cuota que vence hoy aún no está en mora (borde)", () => {
    expect(overdueBalanceMinor([inst(1, today, 4200, 0)], today)).toBe(0);
  });

  it("0 cuando toda cuota vencida está saldada", () => {
    const list = [inst(1, "2026-06-05", 4200, 4200), inst(2, "2026-06-12", 4200, 0)];
    expect(overdueBalanceMinor(list, today)).toBe(0);
  });

  it("cartera vacía no tiene mora", () => {
    expect(overdueBalanceMinor([], today)).toBe(0);
  });
});

describe("dueOnDateMinor", () => {
  it("suma el saldo de las cuotas que vencen en la fecha", () => {
    const list = [
      inst(1, "2026-06-10", 4200, 1000), // vence hoy, saldo 3200
      inst(2, "2026-06-10", 4200, 4200), // vence hoy, saldo 0
      inst(3, "2026-06-11", 4200, 0), // otro día
    ];
    expect(dueOnDateMinor(list, "2026-06-10")).toBe(3200);
  });

  it("0 si no vence nada en la fecha", () => {
    expect(dueOnDateMinor([inst(1, "2026-06-11", 4200, 0)], "2026-06-10")).toBe(0);
  });
});
