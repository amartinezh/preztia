import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { DEFAULT_OPERATIONAL_SETTINGS, mergeOperationalSettings } from "./operational-settings";

describe("mergeOperationalSettings — liquidación", () => {
  it("acepta un día de inicio acorde a la frecuencia", () => {
    expect(
      mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, { settlementFrequency: "MONTHLY", settlementAnchorDay: 28 }),
    ).toMatchObject({ settlementFrequency: "MONTHLY", settlementAnchorDay: 28 });
  });

  it("rechaza un día de inicio semanal mayor que 7 (domingo)", () => {
    expect(() =>
      mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, { settlementFrequency: "WEEKLY", settlementAnchorDay: 15 }),
    ).toThrow(DomainError);
  });

  it("valida la combinación aunque el parche traiga solo uno de los dos campos", () => {
    const monthly15 = mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, {
      settlementFrequency: "MONTHLY",
      settlementAnchorDay: 15,
    });
    expect(() => mergeOperationalSettings(monthly15, { settlementFrequency: "WEEKLY" })).toThrow(DomainError);
  });
});

describe("mergeOperationalSettings — comisión del cobrador", () => {
  it("el valor por defecto puede llegar hasta el tope (incluido)", () => {
    const merged = mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, {
      commissionMaxPctBaseThousand: 100,
      commissionPctBaseThousand: 100,
      commissionBase: "REMITTED",
    });
    expect(merged).toMatchObject({ commissionPctBaseThousand: 100, commissionBase: "REMITTED" });
  });

  it("el valor por defecto no puede superar el tope (409 COMMISSION_ABOVE_CAP)", () => {
    expect(() =>
      mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, { commissionPctBaseThousand: 50 }),
    ).toThrow(expect.objectContaining({ code: "COMMISSION_ABOVE_CAP" }));
  });

  it("bajar el tope por debajo del valor por defecto exige bajar primero el defecto", () => {
    const withCap = mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, {
      commissionMaxPctBaseThousand: 100,
      commissionPctBaseThousand: 80,
    });
    expect(() => mergeOperationalSettings(withCap, { commissionMaxPctBaseThousand: 50 })).toThrow(DomainError);
  });

  it("un tope fuera de [0, 100 %] es inválido", () => {
    expect(() => mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, { commissionMaxPctBaseThousand: 1001 })).toThrow(DomainError);
  });
});

describe("mergeOperationalSettings — interruptor de comisiones", () => {
  it("las comisiones nacen apagadas y el ADMIN las enciende sin tocar el resto", () => {
    expect(DEFAULT_OPERATIONAL_SETTINGS.commissionsEnabled).toBe(false);
    const on = mergeOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS, { commissionsEnabled: true });
    expect(on).toEqual({ ...DEFAULT_OPERATIONAL_SETTINGS, commissionsEnabled: true });
  });
});
