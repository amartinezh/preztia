import { describe, it, expect } from "vitest";
import {
  isEligiblePixCredit,
  matchCreditsToClaims,
  type NormalizedCredit,
  type ReceiptClaimRef,
} from "./settlement-match";

function credit(overrides: Partial<NormalizedCredit> = {}): NormalizedCredit {
  return {
    sourceId: "src-1",
    amountMinor: 10000,
    netAmountMinor: 10000,
    currency: "BRL",
    paymentMethodType: "bank_transfer",
    transactionType: "payment",
    settlementDate: "2026-06-10T12:00:00Z",
    ...overrides,
  };
}

describe("isEligiblePixCredit (I3)", () => {
  it("acepta un crédito PIX recibido (bank_transfer, neto > 0)", () => {
    expect(isEligiblePixCredit(credit())).toBe(true);
  });

  it("excluye lo que no es bank_transfer (ej. tarjeta)", () => {
    expect(isEligiblePixCredit(credit({ paymentMethodType: "credit_card" }))).toBe(false);
  });

  it("excluye neto <= 0 (retiro/débito)", () => {
    expect(isEligiblePixCredit(credit({ netAmountMinor: 0 }))).toBe(false);
    expect(isEligiblePixCredit(credit({ netAmountMinor: -500 }))).toBe(false);
  });

  it("excluye REFUND y CHARGEBACK (case-insensitive)", () => {
    expect(isEligiblePixCredit(credit({ transactionType: "REFUND" }))).toBe(false);
    expect(isEligiblePixCredit(credit({ transactionType: "chargeback" }))).toBe(false);
  });
});

describe("matchCreditsToClaims", () => {
  it("empareja por monto exacto (I2)", () => {
    const claims: ReceiptClaimRef[] = [{ id: "c1", amountMinor: 10000 }];
    const res = matchCreditsToClaims(claims, [credit({ sourceId: "s1", amountMinor: 10000 })]);
    expect(res.matches).toEqual([{ claimId: "c1", sourceId: "s1", amountMinor: 10000 }]);
    expect(res.unmatchedClaimIds).toEqual([]);
  });

  it("no empareja si el monto difiere (I2)", () => {
    const res = matchCreditsToClaims(
      [{ id: "c1", amountMinor: 10001 }],
      [credit({ amountMinor: 10000 })],
    );
    expect(res.matches).toEqual([]);
    expect(res.unmatchedClaimIds).toEqual(["c1"]);
  });

  it("N comprobantes con el mismo monto y UN solo crédito: solo uno valida (I1)", () => {
    const claims: ReceiptClaimRef[] = [
      { id: "c1", amountMinor: 10000 },
      { id: "c2", amountMinor: 10000 },
      { id: "c3", amountMinor: 10000 },
    ];
    const res = matchCreditsToClaims(claims, [credit({ sourceId: "s1", amountMinor: 10000 })]);
    expect(res.matches).toHaveLength(1);
    expect(res.unmatchedClaimIds).toHaveLength(2);
    // El crédito se consumió una sola vez.
    expect(new Set(res.matches.map((m) => m.sourceId)).size).toBe(1);
  });

  it("un segundo crédito real válido valida un segundo pedido", () => {
    const claims: ReceiptClaimRef[] = [
      { id: "c1", amountMinor: 10000 },
      { id: "c2", amountMinor: 10000 },
    ];
    const credits = [
      credit({ sourceId: "s1", amountMinor: 10000 }),
      credit({ sourceId: "s2", amountMinor: 10000, settlementDate: "2026-06-11T12:00:00Z" }),
    ];
    const res = matchCreditsToClaims(claims, credits);
    expect(res.matches).toHaveLength(2);
    expect(res.unmatchedClaimIds).toEqual([]);
    // Cada crédito (sourceId) se usó a lo sumo una vez (I1).
    expect(new Set(res.matches.map((m) => m.sourceId)).size).toBe(2);
  });

  it("sin créditos: todos los comprobantes quedan sin confirmar (I5)", () => {
    const res = matchCreditsToClaims([{ id: "c1", amountMinor: 10000 }], []);
    expect(res.matches).toEqual([]);
    expect(res.unmatchedClaimIds).toEqual(["c1"]);
  });

  it("ignora créditos no elegibles aunque el monto coincida (I3)", () => {
    const res = matchCreditsToClaims(
      [{ id: "c1", amountMinor: 10000 }],
      [credit({ amountMinor: 10000, transactionType: "refund" })],
    );
    expect(res.unmatchedClaimIds).toEqual(["c1"]);
  });

  it("es determinista: misma entrada → misma salida", () => {
    const claims: ReceiptClaimRef[] = [
      { id: "c2", amountMinor: 10000 },
      { id: "c1", amountMinor: 10000 },
    ];
    const credits = [
      credit({ sourceId: "s2", amountMinor: 10000, settlementDate: "2026-06-11T00:00:00Z" }),
      credit({ sourceId: "s1", amountMinor: 10000, settlementDate: "2026-06-10T00:00:00Z" }),
    ];
    const a = matchCreditsToClaims(claims, credits);
    const b = matchCreditsToClaims(claims, credits);
    expect(a).toEqual(b);
  });

  // PROPERTY TEST (PRNG sembrado, sin dependencias): los invariantes se sostienen sobre
  // entradas aleatorias.
  it("property: invariantes I1/I2/I5 sobre 300 casos aleatorios", () => {
    const rand = mulberry32(0xc0ffee);
    for (let iter = 0; iter < 300; iter++) {
      const claims = makeClaims(rand);
      const credits = makeCredits(rand);
      const res = matchCreditsToClaims(claims, credits);

      // Partición: matches + unmatched cubren exactamente los claims, sin repetir.
      const matchedIds = res.matches.map((m) => m.claimId);
      const allOut = [...matchedIds, ...res.unmatchedClaimIds].sort();
      expect(allOut).toEqual(claims.map((c) => c.id).sort());

      // I1: ningún crédito (sourceId) se consume más de una vez.
      expect(new Set(matchedIds).size).toBe(matchedIds.length);
      expect(new Set(res.matches.map((m) => m.sourceId)).size).toBe(res.matches.length);

      // I2: todo match tiene un crédito ELEGIBLE del mismo monto.
      for (const m of res.matches) {
        const used = credits.find((c) => c.sourceId === m.sourceId);
        expect(used && isEligiblePixCredit(used)).toBe(true);
        expect(used?.amountMinor).toBe(m.amountMinor);
      }

      // Cota: no se pueden confirmar más comprobantes que créditos elegibles disponibles.
      const eligible = credits.filter(isEligiblePixCredit).length;
      expect(res.matches.length).toBeLessThanOrEqual(eligible);
    }
  });
});

// --- utilidades del property test (deterministas, sin dependencias) ---

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClaims(rand: () => number): ReceiptClaimRef[] {
  const n = Math.floor(rand() * 6); // 0..5
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    amountMinor: 10000 + Math.floor(rand() * 5) * 100, // pocos montos → fuerza colisiones
  }));
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}

function makeCredits(rand: () => number): NormalizedCredit[] {
  const n = Math.floor(rand() * 6); // 0..5
  const methods = ["bank_transfer", "credit_card"];
  const types = ["payment", "refund", "chargeback"];
  return Array.from({ length: n }, (_, i) => ({
    sourceId: `s${i}`,
    amountMinor: 10000 + Math.floor(rand() * 5) * 100,
    netAmountMinor: rand() < 0.85 ? 10000 : 0,
    currency: "BRL",
    paymentMethodType: pick(methods, rand),
    transactionType: pick(types, rand),
    settlementDate: `2026-06-${10 + (i % 5)}T00:00:00Z`,
  }));
}
