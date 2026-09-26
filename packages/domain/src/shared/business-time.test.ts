import { describe, it, expect } from "vitest";
import { DomainError } from "./money";
import { addDays, businessDateOf, localHourInstant } from "./business-time";

const BOGOTA = "America/Bogota"; // UTC−5 sin horario de verano
const SAO_PAULO = "America/Sao_Paulo"; // UTC−3

describe("businessDateOf", () => {
  it("usa la fecha LOCAL del tenant, no la UTC", () => {
    // 03:00 UTC del 26 = 22:00 del 25 en Bogotá.
    expect(businessDateOf(new Date("2026-09-26T03:00:00Z"), BOGOTA)).toBe("2026-09-25");
    expect(businessDateOf(new Date("2026-09-26T05:00:00Z"), BOGOTA)).toBe("2026-09-26");
  });

  it("rechaza una zona horaria inválida", () => {
    expect(() => businessDateOf(new Date(), "Marte/Olympus")).toThrow(DomainError);
  });
});

describe("localHourInstant", () => {
  it("convierte una hora local del día de negocio al instante UTC", () => {
    expect(localHourInstant("2026-09-25", 20, BOGOTA).toISOString()).toBe("2026-09-26T01:00:00.000Z");
    expect(localHourInstant("2026-09-25", 20, SAO_PAULO).toISOString()).toBe("2026-09-25T23:00:00.000Z");
  });

  it("respeta el horario de verano de la zona", () => {
    // Nueva York: UTC−4 en julio (verano), UTC−5 en enero.
    expect(localHourInstant("2026-07-10", 20, "America/New_York").toISOString()).toBe("2026-07-11T00:00:00.000Z");
    expect(localHourInstant("2026-01-10", 20, "America/New_York").toISOString()).toBe("2026-01-11T01:00:00.000Z");
  });

  it("falla rápido ante fecha u hora inválidas", () => {
    expect(() => localHourInstant("2026-02-31", 20, BOGOTA)).toThrow(DomainError);
    expect(() => localHourInstant("2026-09-25", 24, BOGOTA)).toThrow(DomainError);
  });
});

describe("addDays", () => {
  it("suma días de calendario cruzando meses y años", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
