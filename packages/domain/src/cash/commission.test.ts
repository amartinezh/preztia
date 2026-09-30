import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../shared/money";
import {
  assertCanPayCommissionFrom,
  assertCommissionPayable,
  assertValidCommissionCap,
  assertValidCommissionPolicy,
  commissionBaseAmount,
  computeCommission,
  remittedAmount,
  resolveCommissionPolicy,
  type CommissionConfig,
} from "./commission";

const config = (overrides: Partial<CommissionConfig> = {}): CommissionConfig => ({
  enabled: true,
  tenantDefault: { ratePerMille: 20, base: "COLLECTED" },
  capPerMille: 100,
  zoneSettings: [
    { zoneId: "z-norte", path: "norte", policy: { ratePerMille: 50, base: "REMITTED" } },
    { zoneId: "z-centro", path: "norte.centro", policy: { ratePerMille: 70, base: "PRINCIPAL_RECOVERED" } },
  ],
  ...overrides,
});

describe("resolveCommissionPolicy — herencia por zona", () => {
  it("usa la configuración propia de la zona", () => {
    expect(resolveCommissionPolicy("norte", config())).toMatchObject({ ratePerMille: 50, base: "REMITTED", sourceZoneId: "z-norte" });
  });

  it("una zona sin configuración hereda del ancestro MÁS CERCANO que la tenga", () => {
    expect(resolveCommissionPolicy("norte.centro.barrio", config())).toMatchObject({
      ratePerMille: 70,
      base: "PRINCIPAL_RECOVERED",
      sourceZoneId: "z-centro",
    });
    expect(resolveCommissionPolicy("norte.oriente", config())).toMatchObject({ sourceZoneId: "z-norte" });
  });

  it("sin configuración en su rama (o sin zona) usa el valor por defecto del tenant", () => {
    expect(resolveCommissionPolicy("sur", config())).toMatchObject({ ratePerMille: 20, base: "COLLECTED", sourceZoneId: null });
    expect(resolveCommissionPolicy(null, config())).toMatchObject({ sourceZoneId: null });
  });

  it("no confunde un prefijo de texto con un ancestro (norteño no es hija de norte)", () => {
    expect(resolveCommissionPolicy("norteno", config()).sourceZoneId).toBeNull();
  });

  it("el tope manda: si baja después, la tasa se recorta y queda marcada", () => {
    const capped = resolveCommissionPolicy("norte.centro", config({ capPerMille: 60 }));
    expect(capped).toMatchObject({ ratePerMille: 60, cappedByLimit: true });
    expect(resolveCommissionPolicy("norte", config({ capPerMille: 60 })).cappedByLimit).toBe(false);
  });

  it("con tope 0 nadie cobra comisión", () => {
    expect(resolveCommissionPolicy("norte", config({ capPerMille: 0 })).ratePerMille).toBe(0);
  });
});

describe("computeCommission", () => {
  const figures = { collectedMinor: 300_001, remittedMinor: 250_000, principalRecoveredMinor: 240_000 };
  const policy = { ratePerMille: 33, base: "COLLECTED" as const, sourceZoneId: null, cappedByLimit: false };

  it("comisión = ⌊ base × tasa / 1000 ⌋ (enteros; el redondeo nunca favorece al pago)", () => {
    // 300.001 × 33 / 1000 = 9.900,033 → 9.900
    expect(computeCommission(policy, figures)).toMatchObject({ baseAmountMinor: 300_001, amountMinor: 9_900 });
  });

  it("invariante 0 ≤ comisión ≤ base, en los bordes (0 %, 100 %, base 0)", () => {
    expect(computeCommission({ ...policy, ratePerMille: 0 }, figures).amountMinor).toBe(0);
    expect(computeCommission({ ...policy, ratePerMille: 1000 }, figures).amountMinor).toBe(300_001);
    expect(computeCommission(policy, { ...figures, collectedMinor: 0 }).amountMinor).toBe(0);
  });

  it("elige la base configurada", () => {
    expect(commissionBaseAmount("COLLECTED", figures)).toBe(300_001);
    expect(commissionBaseAmount("REMITTED", figures)).toBe(250_000);
    expect(commissionBaseAmount("PRINCIPAL_RECOVERED", figures)).toBe(240_000);
  });
});

describe("remittedAmount", () => {
  it("lo rendido = salidas − base recibida, nunca negativo", () => {
    expect(remittedAmount(250_000, 50_000)).toBe(200_000);
    expect(remittedAmount(10_000, 50_000)).toBe(0);
  });
});

describe("assertValidCommissionPolicy / assertValidCommissionCap", () => {
  it("acepta una tasa entera dentro del tope (incluido el límite exacto)", () => {
    expect(() => assertValidCommissionPolicy({ ratePerMille: 100, base: "COLLECTED" }, 100)).not.toThrow();
  });

  it("rechaza superar el tope del ADMIN con 409 COMMISSION_ABOVE_CAP", () => {
    const run = () => assertValidCommissionPolicy({ ratePerMille: 101, base: "COLLECTED" }, 100);
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(expect.objectContaining({ code: "COMMISSION_ABOVE_CAP" }));
  });

  it("rechaza tasas no enteras, negativas o sobre 100 % y bases desconocidas", () => {
    for (const ratePerMille of [-1, 12.5, 1001]) {
      expect(() => assertValidCommissionPolicy({ ratePerMille, base: "COLLECTED" }, 1000)).toThrow(DomainError);
    }
    expect(() => assertValidCommissionPolicy({ ratePerMille: 10, base: "OTHER" as never }, 1000)).toThrow(DomainError);
    expect(() => assertValidCommissionCap(1001)).toThrow(DomainError);
    expect(() => assertValidCommissionCap(0)).not.toThrow();
  });
});

describe("assertCanPayCommissionFrom", () => {
  it("desde su propia caja de ruta sí; desde la de otro cobrador no", () => {
    expect(() =>
      assertCanPayCommissionFrom({ collectorId: "ana", collectorZonePath: "norte", box: { assignedTo: "ana", zonePath: "norte" } }),
    ).not.toThrow();
    expect(() =>
      assertCanPayCommissionFrom({ collectorId: "ana", collectorZonePath: "norte", box: { assignedTo: "beto", zonePath: "norte" } }),
    ).toThrow(expect.objectContaining({ code: "COMMISSION_BOX_NOT_ALLOWED" }));
  });

  it("desde oficina de su zona, de una superior o del tenant; no de una zona hermana", () => {
    const pay = (zonePath: string | null) =>
      assertCanPayCommissionFrom({ collectorId: "ana", collectorZonePath: "norte.centro", box: { assignedTo: null, zonePath } });
    expect(() => pay("norte.centro")).not.toThrow();
    expect(() => pay("norte")).not.toThrow();
    expect(() => pay(null)).not.toThrow();
    expect(() => pay("sur")).toThrow(expect.objectContaining({ code: "BOX_NOT_USABLE_BY_ZONE" }));
  });

  it("un cobrador sin zona solo cobra de cajas generales del tenant", () => {
    expect(() =>
      assertCanPayCommissionFrom({ collectorId: "ana", collectorZonePath: null, box: { assignedTo: null, zonePath: "norte" } }),
    ).toThrow(expect.objectContaining({ code: "BOX_NOT_USABLE_BY_ZONE" }));
  });
});

describe("assertCommissionPayable", () => {
  it("no se paga una comisión en cero", () => {
    expect(() => assertCommissionPayable(0)).toThrow(expect.objectContaining({ code: "NOTHING_TO_PAY" }));
    expect(() => assertCommissionPayable(1)).not.toThrow();
  });
});
