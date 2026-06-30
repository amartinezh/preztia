import { describe, it, expect } from "vitest";
import { matchReceiver } from "./receiver-match";

describe("matchReceiver", () => {
  it("coincide por llave PIX (ignora máscara/mayúsculas)", () => {
    const r = matchReceiver(
      { pixKey: "PIX@Preztia.com", name: null },
      { pixKey: "pix@preztia.com", name: null },
    );
    expect(r.matches).toBe(true);
    expect(r.inconclusive).toBe(false);
  });

  it("coincide por llave PIX de CNPJ con y sin formato", () => {
    const r = matchReceiver(
      { pixKey: "12.345.678/0001-99", name: null },
      { pixKey: "12345678000199", name: null },
    );
    expect(r.matches).toBe(true);
  });

  it("NO coincide cuando la llave PIX difiere (crédito a otra cuenta) → rechazo", () => {
    const r = matchReceiver(
      { pixKey: "otro@banco.com", name: "Preztia LTDA" },
      { pixKey: "pix@preztia.com", name: "Preztia LTDA" },
    );
    expect(r.matches).toBe(false);
    expect(r.inconclusive).toBe(false);
    expect(r.reasons[0]).toContain("llave PIX");
  });

  it("cae al titular cuando no hay llaves comparables (coincidencia tolerante)", () => {
    const r = matchReceiver(
      { pixKey: null, name: "Preztia Servicios Financieros LTDA" },
      { pixKey: null, name: "PREZTIA SERVICIOS FINANCIEROS" },
    );
    expect(r.matches).toBe(true);
  });

  it("NO coincide cuando el titular difiere", () => {
    const r = matchReceiver(
      { pixKey: null, name: "Otra Empresa SA" },
      { pixKey: null, name: "Preztia LTDA" },
    );
    expect(r.matches).toBe(false);
    expect(r.inconclusive).toBe(false);
    expect(r.reasons[0]).toContain("titular");
  });

  it("es NO CONCLUYENTE cuando no hay nada comparable", () => {
    const r = matchReceiver(
      { pixKey: null, name: null },
      { pixKey: "pix@preztia.com", name: "Preztia LTDA" },
    );
    expect(r.matches).toBe(false);
    expect(r.inconclusive).toBe(true);
  });
});
