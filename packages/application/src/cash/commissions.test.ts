import { describe, it, expect } from "vitest";
import { ConflictError, NotFoundError, type CommissionPolicy } from "@preztiaos/domain";

import {
  PayCollectorCommissionHandler,
  SetZoneCommissionHandler,
  type CommissionActor,
  type CommissionPaymentStore,
  type ZoneCommissionStore,
} from "./commissions";

const ADMIN: CommissionActor = { userId: "admin", scopes: null };
const COORD_NORTE: CommissionActor = { userId: "coord", scopes: ["norte"] };

class FakeZones implements ZoneCommissionStore {
  saved: { zoneId: string; policy: CommissionPolicy | null; actorId: string }[] = [];
  constructor(private readonly zones: Record<string, string>, private readonly cap: number) {}
  async loadZone({ zoneId }: { zoneId: string }) {
    const path = this.zones[zoneId];
    return path ? { path, capPerMille: this.cap } : null;
  }
  async saveZonePolicy(input: { zoneId: string; policy: CommissionPolicy | null; actorId: string }) {
    this.saved.push({ zoneId: input.zoneId, policy: input.policy, actorId: input.actorId });
  }
}

describe("SetZoneCommissionHandler", () => {
  const zones = () => new FakeZones({ "z-norte": "norte", "z-centro": "norte.centro", "z-sur": "sur" }, 100);
  const set = (store: FakeZones, zoneId: string, policy: CommissionPolicy | null, actor = COORD_NORTE) =>
    new SetZoneCommissionHandler(store).execute({ tenantId: "t", zoneId, policy, actor });

  it("el coordinador configura una zona de su subárbol (y la propia) y queda su autoría", async () => {
    const store = zones();
    await set(store, "z-centro", { ratePerMille: 50, base: "REMITTED" });
    await set(store, "z-norte", { ratePerMille: 100, base: "COLLECTED" });
    expect(store.saved).toEqual([
      { zoneId: "z-centro", policy: { ratePerMille: 50, base: "REMITTED" }, actorId: "coord" },
      { zoneId: "z-norte", policy: { ratePerMille: 100, base: "COLLECTED" }, actorId: "coord" },
    ]);
  });

  it("no puede superar el tope del ADMIN (409) ni se guarda nada", async () => {
    const store = zones();
    await expect(set(store, "z-centro", { ratePerMille: 101, base: "COLLECTED" })).rejects.toBeInstanceOf(ConflictError);
    expect(store.saved).toHaveLength(0);
  });

  it("una zona fuera de su alcance responde como inexistente (404) y no se toca", async () => {
    const store = zones();
    await expect(set(store, "z-sur", { ratePerMille: 10, base: "COLLECTED" })).rejects.toBeInstanceOf(NotFoundError);
    expect(store.saved).toHaveLength(0);
  });

  it("quitar la configuración (heredar) no valida tope; el ADMIN alcanza cualquier zona", async () => {
    const store = zones();
    await set(store, "z-sur", null, ADMIN);
    expect(store.saved).toEqual([{ zoneId: "z-sur", policy: null, actorId: "admin" }]);
  });

  it("zona inexistente: 404", async () => {
    await expect(set(zones(), "z-x", null, ADMIN)).rejects.toBeInstanceOf(NotFoundError);
  });
});

class FakePayments implements CommissionPaymentStore {
  paid: Parameters<CommissionPaymentStore["pay"]>[0][] = [];
  constructor(
    private readonly due: { amountMinor: number; collectorZoneId: string | null; collectorZonePath: string | null } | null,
  ) {}
  async loadDue() {
    return this.due;
  }
  async pay(input: Parameters<CommissionPaymentStore["pay"]>[0]) {
    this.paid.push(input);
    return { cashTransactionId: "tx-1" };
  }
}

describe("PayCollectorCommissionHandler", () => {
  const pay = (store: FakePayments, actor: CommissionActor = COORD_NORTE) =>
    new PayCollectorCommissionHandler(store).execute({
      tenantId: "t",
      settlementId: "s-1",
      collectorId: "ana",
      cashBoxId: "oficina",
      actor,
    });

  it("paga EXACTAMENTE lo causado en la foto, desde la caja elegida, a nombre de quien paga", async () => {
    const store = new FakePayments({ amountMinor: 15_000, collectorZoneId: "z-centro", collectorZonePath: "norte.centro" });
    await expect(pay(store)).resolves.toEqual({ cashTransactionId: "tx-1", amountMinor: 15_000 });
    expect(store.paid).toEqual([
      {
        tenantId: "t",
        settlementId: "s-1",
        collectorId: "ana",
        collectorZoneId: "z-centro",
        collectorZonePath: "norte.centro",
        cashBoxId: "oficina",
        amountMinor: 15_000,
        paidBy: "coord",
      },
    ]);
  });

  it("comisión en cero: 409 NOTHING_TO_PAY sin asiento", async () => {
    const store = new FakePayments({ amountMinor: 0, collectorZoneId: null, collectorZonePath: "norte" });
    await expect(pay(store)).rejects.toMatchObject({ code: "NOTHING_TO_PAY" });
    expect(store.paid).toHaveLength(0);
  });

  it("cobrador fuera del subárbol (o sin zona) del coordinador: 404; el ADMIN sí puede", async () => {
    await expect(pay(new FakePayments({ amountMinor: 1, collectorZoneId: null, collectorZonePath: "sur" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(pay(new FakePayments({ amountMinor: 1, collectorZoneId: null, collectorZonePath: null }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(pay(new FakePayments({ amountMinor: 1, collectorZoneId: null, collectorZonePath: null }), ADMIN)).resolves.toMatchObject({ amountMinor: 1 });
  });

  it("sin línea en la liquidación: 404", async () => {
    await expect(pay(new FakePayments(null), ADMIN)).rejects.toBeInstanceOf(NotFoundError);
  });
});
