import { describe, it, expect } from "vitest";
import { DomainError } from "@preztiaos/domain";

import {
  RegisterMigratedCreditHandler,
  type MigratedCreditStore,
  type RegisterMigratedCreditCommand,
} from "./register-migrated-credit";

class FakeStore implements MigratedCreditStore {
  saved: Parameters<MigratedCreditStore["save"]>[0][] = [];
  async timeZone() {
    return "America/Bogota";
  }
  async save(input: Parameters<MigratedCreditStore["save"]>[0]) {
    this.saved.push(input);
  }
}

// "Ahora" = 2026-09-29 10:00 en Bogotá.
const NOW = new Date("2026-09-29T15:00:00.000Z");
const cmd: RegisterMigratedCreditCommand = {
  tenantId: "t",
  borrowerId: "b",
  zoneId: "z",
  principalMinor: 100_000,
  interestPct: 200,
  installmentsCount: 4,
  frequency: "WEEKLY",
  currency: "COP",
  startDate: "2026-08-03",
  legacyReference: "LEG-42",
  payments: [
    { paidOn: "2026-08-10", amountMinor: 30_000 },
    { paidOn: "2026-08-17", amountMinor: 45_000 },
  ],
  migratedBy: "admin",
};

describe("RegisterMigratedCreditHandler", () => {
  it("calcula el cronograma desde la fecha de inicio pasada y reparte los abonos en cascada", async () => {
    const store = new FakeStore();
    const result = await new RegisterMigratedCreditHandler(store, () => NOW).execute(cmd);

    expect(result).toEqual({ id: expect.any(String), installments: 4, paidMinor: 75_000, balanceMinor: 45_000, settled: false });
    const saved = store.saved[0]!;
    expect(saved.credit).toMatchObject({ startDate: "2026-08-03", endDate: "2026-08-31", legacyReference: "LEG-42", settled: false });
    expect(saved.installments.map((i) => i.dueDate)).toEqual(["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
    // Las asignaciones apuntan a las cuotas que se van a persistir (ids generados en el caso de uso).
    const ids = new Set(saved.installments.map((i) => i.id));
    for (const p of saved.payments) for (const a of p.allocations) expect(ids.has(a.installmentId)).toBe(true);
    // Abono histórico fechado a mediodía local de su día.
    expect(saved.payments[0]!.paidAt.toISOString()).toBe("2026-08-10T17:00:00.000Z");
  });

  it("un abono de hoy no queda con hora futura", async () => {
    const store = new FakeStore();
    await new RegisterMigratedCreditHandler(store, () => NOW).execute({
      ...cmd,
      payments: [{ paidOn: "2026-09-29", amountMinor: 1_000 }],
    });
    expect(store.saved[0]!.payments[0]!.paidAt).toEqual(NOW);
  });

  it("todo abonado en el sistema anterior: se carga saldado", async () => {
    const store = new FakeStore();
    const result = await new RegisterMigratedCreditHandler(store, () => NOW).execute({
      ...cmd,
      payments: [{ paidOn: "2026-09-01", amountMinor: 120_000 }],
    });
    expect(result).toMatchObject({ settled: true, balanceMinor: 0 });
    expect(store.saved[0]!.credit.settled).toBe(true);
  });

  it("datos inválidos (sobrepago, inicio futuro): falla sin persistir nada", async () => {
    const store = new FakeStore();
    const handler = new RegisterMigratedCreditHandler(store, () => NOW);
    await expect(handler.execute({ ...cmd, payments: [{ paidOn: "2026-09-01", amountMinor: 120_001 }] })).rejects.toBeInstanceOf(DomainError);
    await expect(handler.execute({ ...cmd, startDate: "2026-09-30", payments: [] })).rejects.toBeInstanceOf(DomainError);
    expect(store.saved).toHaveLength(0);
  });
});
