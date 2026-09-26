import { describe, it, expect } from "vitest";
import {
  buildSettlement,
  collectorPerformance,
  conceptOf,
  scopeSettlement,
  SETTLEMENT_CONCEPTS,
  type SettlementFlow,
} from "./settlement";

const NORTE = { zoneId: "z-norte", name: "Norte", path: "norte" };
const SUR = { zoneId: "z-sur", name: "Sur", path: "sur" };

const boxes = [
  { cashBoxId: "oficina-norte", name: "Oficina Norte", type: "CASH" as const, zoneId: "z-norte", zonePath: "norte", collectorId: null, openingMinor: 1_000_000 },
  { cashBoxId: "ruta-ana", name: "Ruta Ana", type: "CASH" as const, zoneId: "z-norte", zonePath: "norte", collectorId: "ana", openingMinor: 20_000 },
  { cashBoxId: "banco", name: "Banco", type: "BANK" as const, zoneId: null, zonePath: null, collectorId: null, openingMinor: 500_000 },
];

function flow(partial: Partial<SettlementFlow> & Pick<SettlementFlow, "cashBoxId" | "kind" | "direction" | "amountMinor">): SettlementFlow {
  return { zoneId: null, collectorId: null, debtClosureType: null, ...partial };
}

const flows: SettlementFlow[] = [
  // Ana cobra 300.000 en Norte y entrega 250.000 a la oficina.
  flow({ cashBoxId: "ruta-ana", zoneId: "z-norte", collectorId: "ana", kind: "PAYMENT_IN", direction: "IN", amountMinor: 300_000 }),
  flow({ cashBoxId: "ruta-ana", zoneId: "z-norte", collectorId: "ana", kind: "TRANSFER", direction: "OUT", amountMinor: 250_000 }),
  flow({ cashBoxId: "oficina-norte", zoneId: "z-norte", kind: "TRANSFER", direction: "IN", amountMinor: 250_000 }),
  // Gasto de Ana pagado desde la oficina; condonación de 5.000 y nómina de 10.000.
  flow({ cashBoxId: "oficina-norte", zoneId: "z-norte", collectorId: "ana", kind: "EXPENSE", direction: "OUT", amountMinor: 15_000 }),
  flow({ cashBoxId: "ruta-ana", zoneId: "z-norte", collectorId: "ana", kind: "DEBT_CLOSURE", direction: "OUT", debtClosureType: "WRITE_OFF", amountMinor: 5_000 }),
  flow({ cashBoxId: "ruta-ana", zoneId: "z-norte", collectorId: "ana", kind: "DEBT_CLOSURE", direction: "OUT", debtClosureType: "PAYROLL", amountMinor: 10_000 }),
  // Desembolso de un crédito de Sur desde el banco (caja del tenant, asiento con zona Sur).
  flow({ cashBoxId: "banco", zoneId: "z-sur", kind: "DISBURSEMENT", direction: "OUT", amountMinor: 200_000 }),
  // PIX no identificado al banco, sin zona.
  flow({ cashBoxId: "banco", kind: "UNIDENTIFIED", direction: "IN", amountMinor: 7_000 }),
];

const portfolio = [
  {
    zoneId: "z-norte",
    interestEarnedMinor: 50_000,
    principalRecoveredMinor: 250_000,
    newCreditsCount: 0,
    newCreditsPrincipalMinor: 0,
    dueInPeriodMinor: 400_000,
    collectedOnPortfolioMinor: 300_000,
    overdueAtCutMinor: 80_000,
  },
  {
    zoneId: "z-sur",
    interestEarnedMinor: 0,
    principalRecoveredMinor: 0,
    newCreditsCount: 1,
    newCreditsPrincipalMinor: 200_000,
    dueInPeriodMinor: 0,
    collectedOnPortfolioMinor: 0,
    overdueAtCutMinor: 0,
  },
];

const snapshot = buildSettlement({
  boxes,
  flows,
  zones: [NORTE, SUR],
  collectors: [{ collectorId: "ana", email: "ana@t.test", zonePath: "norte" }],
  portfolio,
});

describe("conceptOf", () => {
  it("clasifica cada asiento en su fila de tesorería", () => {
    expect(conceptOf("PAYMENT_IN", "IN", null)).toBe("COLLECTED");
    expect(conceptOf("DISBURSEMENT", "OUT", null)).toBe("DISBURSED");
    expect(conceptOf("TRANSFER", "OUT", null)).toBe("TRANSFERS_OUT");
    expect(conceptOf("DEBT_CLOSURE", "OUT", "WRITE_OFF")).toBe("DEBT_WRITE_OFF");
    expect(conceptOf("DEBT_CLOSURE", "OUT", "PAYROLL")).toBe("DEBT_PAYROLL");
  });
});

describe("buildSettlement — tesorería", () => {
  it("I1: por caja y en total, inicial + entradas − salidas = final", () => {
    for (const b of snapshot.boxes) {
      expect(b.openingMinor + b.inMinor - b.outMinor).toBe(b.closingMinor);
    }
    const t = snapshot.totals;
    expect(t.openingMinor + t.inMinor - t.outMinor).toBe(t.closingMinor);
    expect(snapshot.boxes.find((b) => b.cashBoxId === "ruta-ana")?.closingMinor).toBe(20_000 + 300_000 - 250_000 - 15_000);
  });

  it("I3: Σ zonas = Σ cajas = total, con una línea para los asientos sin zona", () => {
    const zonesIn = snapshot.zones.reduce((a, z) => a + z.inMinor, 0);
    const zonesOut = snapshot.zones.reduce((a, z) => a + z.outMinor, 0);
    expect(zonesIn).toBe(snapshot.totals.inMinor);
    expect(zonesOut).toBe(snapshot.totals.outMinor);
    expect(snapshot.zones.find((z) => z.zoneId === null)?.concepts.UNIDENTIFIED).toBe(7_000);
    for (const c of SETTLEMENT_CONCEPTS) {
      expect(snapshot.zones.reduce((a, z) => a + z.concepts[c], 0)).toBe(snapshot.totals.concepts[c]);
    }
  });
});

describe("buildSettlement — resultado", () => {
  it("utilidad = interés ganado − gastos − condonado (la nómina no es pérdida)", () => {
    const norte = snapshot.zones.find((z) => z.zoneId === "z-norte")!.result;
    expect(norte).toMatchObject({
      interestEarnedMinor: 50_000,
      expensesMinor: 15_000,
      writeOffMinor: 5_000,
      payrollRecoveredMinor: 10_000,
      utilityMinor: 30_000,
      collectionRatePerMille: 750,
    });
    expect(snapshot.result.utilityMinor).toBe(30_000);
    expect(snapshot.result.newCreditsPrincipalMinor).toBe(200_000);
  });

  it("sin cuotas que vencieran, el % de recaudo no aplica", () => {
    expect(snapshot.zones.find((z) => z.zoneId === "z-sur")!.result.collectionRatePerMille).toBeNull();
  });
});

describe("buildSettlement — por cobrador", () => {
  it("resume lo que recogió, gastó, entregó, lo cerrado de su deuda y su efectivo al corte", () => {
    expect(snapshot.collectors[0]).toMatchObject({
      collectedMinor: 300_000,
      expensesMinor: 15_000,
      transferredOutMinor: 250_000,
      payrollMinor: 10_000,
      writeOffMinor: 5_000,
      closingCashMinor: 20_000 + 300_000 - 250_000 - 5_000 - 10_000,
    });
  });
});

describe("scopeSettlement", () => {
  it("el ADMIN ve todo", () => {
    expect(scopeSettlement(snapshot, null)).toBe(snapshot);
  });

  it("el coordinador de Norte ve solo sus cajas, zonas y cobradores, con totales recalculados", () => {
    const scoped = scopeSettlement(snapshot, ["norte"]);
    expect(scoped.boxes.map((b) => b.cashBoxId).sort()).toEqual(["oficina-norte", "ruta-ana"]);
    expect(scoped.zones.map((z) => z.zoneId)).toEqual(["z-norte"]);
    expect(scoped.collectors).toHaveLength(1);
    expect(scoped.totals.openingMinor).toBe(1_020_000);
    expect(scoped.result.newCreditsCount).toBe(0);
  });
});

describe("collectorPerformance", () => {
  it("calcula tasa de visitas efectivas y promedios de respuesta", () => {
    expect(
      collectorPerformance({
        collectorId: "ana",
        stopsDispatched: 10,
        stopsResolved: 8,
        stopsPaid: 6,
        resolveMinutesTotal: 800,
        depositsIssued: 2,
        depositsVerified: 1,
        depositReportMinutesTotal: 90,
        depositsReported: 2,
        remittancesSubmitted: 5,
        remittancesLate: 1,
      }),
    ).toMatchObject({ effectiveVisitRatePerMille: 750, avgResolveMinutes: 100, avgDepositReportMinutes: 45 });
  });

  it("sin actividad no inventa tasas ni promedios", () => {
    expect(collectorPerformance(undefined)).toMatchObject({
      stopsDispatched: 0,
      effectiveVisitRatePerMille: null,
      avgResolveMinutes: null,
      avgDepositReportMinutes: null,
    });
  });
});
