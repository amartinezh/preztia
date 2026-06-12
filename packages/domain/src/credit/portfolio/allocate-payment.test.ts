import { describe, it, expect } from "vitest";
import { Money } from "../../shared/money";
import { allocatePayment } from "./allocate-payment";
import type { PortfolioInstallment } from "./installment";

const CURRENCY = "BRL";

function installment(seq: number, amountDueMinor: number, paidMinor = 0): PortfolioInstallment {
  return {
    id: `inst-${seq}`,
    seq,
    dueDate: `2026-06-${String(seq).padStart(2, "0")}`,
    amountDueMinor,
    paidMinor,
    status: paidMinor === 0 ? "PENDING" : paidMinor === amountDueMinor ? "PAID" : "PARTIALLY_PAID",
  };
}

describe("allocatePayment", () => {
  it("abono en cascada: paga cuotas completas y deja la siguiente parcial", () => {
    // Dado un crédito con 3 cuotas de 100, cuando llega un pago de 250
    const result = allocatePayment(
      CURRENCY,
      [installment(1, 10000), installment(2, 10000), installment(3, 10000)],
      Money.of(25000, CURRENCY),
    );

    expect(result.installments[0]?.status).toBe("PAID");
    expect(result.installments[1]?.status).toBe("PAID");
    expect(result.installments[2]?.status).toBe("PARTIALLY_PAID");
    expect(result.installments[2]?.paidMinor).toBe(5000);
    const allocated = result.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated).toBe(25000); // Σ asignaciones = pago
    expect(result.overpaymentMinor).toBe(0);
    expect(result.creditSettled).toBe(false);
  });

  it("pago parcial: la primera cuota queda PARTIALLY_PAID con su saldo", () => {
    const result = allocatePayment(
      CURRENCY,
      [installment(1, 10000), installment(2, 10000)],
      Money.of(4000, CURRENCY),
    );

    expect(result.installments[0]?.status).toBe("PARTIALLY_PAID");
    expect(result.installments[0]?.paidMinor).toBe(4000);
    expect(result.installments[1]?.status).toBe("PENDING");
    expect(result.allocations).toHaveLength(1);
  });

  it("pago exacto del saldo: todas PAID y crédito saldado", () => {
    const result = allocatePayment(
      CURRENCY,
      [installment(1, 10000, 5000), installment(2, 10000)],
      Money.of(15000, CURRENCY),
    );

    expect(result.installments.every((i) => i.status === "PAID")).toBe(true);
    expect(result.creditSettled).toBe(true);
    expect(result.overpaymentMinor).toBe(0);
  });

  it("sobrepago: salda la cartera y reporta el saldo a favor", () => {
    // saldo 300, pago 350 → saldado + 50 a favor
    const result = allocatePayment(
      CURRENCY,
      [installment(1, 10000), installment(2, 10000), installment(3, 10000)],
      Money.of(35000, CURRENCY),
    );

    expect(result.creditSettled).toBe(true);
    expect(result.overpaymentMinor).toBe(5000);
    const allocated = result.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated + result.overpaymentMinor).toBe(35000); // invariante central
  });

  it("invariante: Σ allocations + overpayment === pago, y paid ≤ due por cuota", () => {
    const result = allocatePayment(
      CURRENCY,
      [installment(1, 3333), installment(2, 3333), installment(3, 3334, 1000)],
      Money.of(7777, CURRENCY),
    );

    const allocated = result.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated + result.overpaymentMinor).toBe(7777);
    for (const i of result.installments) {
      expect(i.paidMinor).toBeLessThanOrEqual(i.amountDueMinor);
    }
  });

  it("cartera ya saldada: 0 asignaciones y todo es saldo a favor", () => {
    const result = allocatePayment(CURRENCY, [installment(1, 10000, 10000)], Money.of(2000, CURRENCY));

    expect(result.allocations).toHaveLength(0);
    expect(result.overpaymentMinor).toBe(2000);
    expect(result.creditSettled).toBe(true);
  });

  it("rechaza moneda distinta", () => {
    expect(() =>
      allocatePayment(CURRENCY, [installment(1, 10000)], Money.of(5000, "COP")),
    ).toThrowError("Moneda distinta");
  });

  it("rechaza pagos no positivos", () => {
    expect(() => allocatePayment(CURRENCY, [installment(1, 10000)], Money.of(0, CURRENCY))).toThrow();
  });
});
