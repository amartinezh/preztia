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
