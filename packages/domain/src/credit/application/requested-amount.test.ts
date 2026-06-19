import { describe, it, expect } from "vitest";
import { parseRequestedAmountMinor, splitFullName } from "./requested-amount";

describe("parseRequestedAmountMinor", () => {
  it("toma los dígitos como unidades mayores y devuelve menores", () => {
    expect(parseRequestedAmountMinor("300000")).toBe(30_000_000);
    expect(parseRequestedAmountMinor("300.000")).toBe(30_000_000);
    expect(parseRequestedAmountMinor("$ 300.000")).toBe(30_000_000);
  });

  it("rechaza texto sin monto o monto no positivo", () => {
    expect(parseRequestedAmountMinor("no sé")).toBeNull();
    expect(parseRequestedAmountMinor("")).toBeNull();
    expect(parseRequestedAmountMinor("0")).toBeNull();
  });
});

describe("splitFullName", () => {
  it("separa primer token (nombre) del resto (apellido)", () => {
    expect(splitFullName("JUAN PEREZ GOMEZ")).toEqual({ firstName: "JUAN", lastName: "PEREZ GOMEZ" });
    expect(splitFullName("  Ana   Lucía  Díaz ")).toEqual({ firstName: "Ana", lastName: "Lucía Díaz" });
  });

  it("maneja un solo token y vacío", () => {
    expect(splitFullName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
    expect(splitFullName(null)).toEqual({ firstName: "", lastName: "" });
  });
});
