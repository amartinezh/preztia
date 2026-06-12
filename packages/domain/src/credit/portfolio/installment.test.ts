import { describe, it, expect } from "vitest";
import { markOverdue, portfolioBalanceMinor, remainingMinor, type PortfolioInstallment } from "./installment";

function installment(overrides: Partial<PortfolioInstallment> = {}): PortfolioInstallment {
  return {
    id: "inst-1",
    seq: 1,
    dueDate: "2026-06-10",
    amountDueMinor: 10000,
    paidMinor: 0,
    status: "PENDING",
    ...overrides,
  };
}

describe("PortfolioInstallment", () => {
  it("remainingMinor es el saldo y nunca negativo", () => {
    expect(remainingMinor(installment({ paidMinor: 4000 }))).toBe(6000);
    expect(() => remainingMinor(installment({ paidMinor: 10001 }))).toThrow();
  });

  it("markOverdue vence cuotas impagas pasadas y respeta las pagas", () => {
    const overdue = markOverdue(installment(), "2026-06-11");
    expect(overdue.status).toBe("OVERDUE");

    const paid = markOverdue(installment({ paidMinor: 10000, status: "PAID" }), "2026-06-11");
    expect(paid.status).toBe("PAID");

    const future = markOverdue(installment({ dueDate: "2026-06-12" }), "2026-06-11");
    expect(future.status).toBe("PENDING");
  });

  it("portfolioBalanceMinor suma los saldos de todas las cuotas", () => {
    const balance = portfolioBalanceMinor([
      installment({ paidMinor: 10000, status: "PAID" }),
      installment({ id: "inst-2", seq: 2, paidMinor: 2500, status: "PARTIALLY_PAID" }),
      installment({ id: "inst-3", seq: 3 }),
    ]);
    expect(balance).toBe(17500);
  });
});
