import { describe, it, expect } from "vitest";
import { analyzeE2EId } from "./e2e-id";

// E2E bien formado: E + ISPB(8) Mercado Pago + 202606101230 (UTC) + 11 alfanuméricos = 32.
const VALID = "E10573521202606101230ABCDEF01234";
// `now` fijo posterior a la fecha del E2E para que no sea "futuro".
const NOW = new Date("2026-06-15T00:00:00Z");

describe("analyzeE2EId", () => {
  it("acepta un E2E bien formado (32, prefijo E, ISPB 8 dígitos, fecha y secuencial)", () => {
    const a = analyzeE2EId(VALID, NOW);
    expect(a.valid).toBe(true);
    expect(a.ispb).toBe("10573521");
    expect(a.issuedAt?.toISOString()).toBe("2026-06-10T12:30:00.000Z");
    expect(a.problems).toEqual([]);
  });

  it("rechaza longitud incorrecta", () => {
    const a = analyzeE2EId("E10573521202606101230ABC", NOW); // 24 chars
    expect(a.valid).toBe(false);
    expect(a.problems.join(" ")).toContain("longitud");
  });

  it("rechaza prefijo distinto de 'E'", () => {
    const a = analyzeE2EId("X10573521202606101230ABCDEF01234", NOW);
    expect(a.valid).toBe(false);
    expect(a.problems.join(" ")).toContain("'E'");
  });

  it("rechaza ISPB no numérico", () => {
    const a = analyzeE2EId("E1057AB21202606101230ABCDEF01234", NOW);
    expect(a.valid).toBe(false);
    expect(a.ispb).toBeNull();
    expect(a.problems.join(" ")).toContain("ISPB");
  });

  it("rechaza fecha imposible (31 de febrero)", () => {
    const a = analyzeE2EId("E10573521202602310000ABCDEF01234", NOW);
    expect(a.valid).toBe(false);
    expect(a.issuedAt).toBeNull();
    expect(a.problems.join(" ")).toContain("fecha");
  });

  it("rechaza fecha en el futuro (más allá de la tolerancia)", () => {
    const future = analyzeE2EId(VALID, new Date("2026-06-09T00:00:00Z"));
    expect(future.valid).toBe(false);
    expect(future.problems.join(" ")).toContain("futuro");
  });

  it("rechaza secuencial con caracteres inválidos", () => {
    const a = analyzeE2EId("E10573521202606101230ABCDEF*1234", NOW);
    expect(a.valid).toBe(false);
    expect(a.problems.join(" ")).toContain("secuencial");
  });
});
