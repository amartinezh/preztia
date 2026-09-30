import { describe, it, expect } from "vitest";
import { DomainError } from "../../shared/money";
import { planMigratedCredit, MAX_HISTORICAL_PAYMENTS } from "./migrated-credit";
import type { PortfolioInstallment } from "../portfolio/installment";

// Crédito de 120.000 en 4 cuotas de 30.000 que empezó el 1 de agosto.
const installments: PortfolioInstallment[] = [1, 2, 3, 4].map((seq) => ({
  id: `i${seq}`,
  seq,
  dueDate: `2026-08-0${seq + 1}`,
  amountDueMinor: 30_000,
  paidMinor: 0,
  status: "PENDING",
}));
const base = { startDate: "2026-08-01", today: "2026-09-29", currency: "COP", installments };

describe("planMigratedCredit", () => {
  it("reparte los abonos en cascada por fecha (no por orden de captura) y Σ asignado = Σ abonos", () => {
    const plan = planMigratedCredit({
      ...base,
      payments: [
        { paidOn: "2026-08-20", amountMinor: 10_000 },
        { paidOn: "2026-08-05", amountMinor: 40_000 },
      ],
    });
    expect(plan.payments.map((p) => p.paidOn)).toEqual(["2026-08-05", "2026-08-20"]);
    expect(plan.payments[0]!.allocations).toEqual([
      { installmentId: "i1", amountMinor: 30_000 },
      { installmentId: "i2", amountMinor: 10_000 },
    ]);
    const allocated = plan.payments.flatMap((p) => p.allocations).reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated).toBe(50_000);
    expect(plan.paidMinor).toBe(50_000);
    expect(plan.installments.map((i) => i.paidMinor)).toEqual([30_000, 20_000, 0, 0]);
    expect(plan.settled).toBe(false);
  });

  it("sin abonos históricos es válido (el crédito arranca con todo su saldo)", () => {
    const plan = planMigratedCredit({ ...base, payments: [] });
    expect(plan).toMatchObject({ paidMinor: 0, settled: false, payments: [] });
  });

  it("pagado por completo en el sistema anterior: queda saldado", () => {
    expect(planMigratedCredit({ ...base, payments: [{ paidOn: "2026-09-01", amountMinor: 120_000 }] }).settled).toBe(true);
  });

  it("límites de fecha inclusivos: el día de inicio y hoy son válidos", () => {
    expect(() =>
      planMigratedCredit({
        ...base,
        payments: [
          { paidOn: "2026-08-01", amountMinor: 1 },
          { paidOn: "2026-09-29", amountMinor: 1 },
        ],
      }),
    ).not.toThrow();
  });

  it("rechaza inicio futuro, abonos antes del inicio o futuros, montos no positivos y sobrepago", () => {
    const bad = [
      { ...base, startDate: "2026-09-30", payments: [] },
      { ...base, payments: [{ paidOn: "2026-07-31", amountMinor: 1_000 }] },
      { ...base, payments: [{ paidOn: "2026-09-30", amountMinor: 1_000 }] },
      { ...base, payments: [{ paidOn: "2026-08-10", amountMinor: 0 }] },
      { ...base, payments: [{ paidOn: "2026-08-10", amountMinor: 10.5 }] },
      { ...base, payments: [{ paidOn: "2026-08-10", amountMinor: 120_001 }] },
    ];
    for (const input of bad) expect(() => planMigratedCredit(input)).toThrow(DomainError);
  });

  it(`admite hasta ${MAX_HISTORICAL_PAYMENTS} abonos`, () => {
    const many = Array.from({ length: MAX_HISTORICAL_PAYMENTS + 1 }, () => ({ paidOn: "2026-08-10", amountMinor: 1 }));
    expect(() => planMigratedCredit({ ...base, payments: many })).toThrow(DomainError);
  });
});
