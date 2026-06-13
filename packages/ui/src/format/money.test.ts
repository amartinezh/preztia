import { describe, expect, it } from "vitest";
import { formatMoney, majorToMinor, minorToMajor } from "./money";

// Invariante de presentación: el dinero entra y sale en unidades menores enteras;
// el formateo nunca debe reintroducir errores de coma flotante en la conversión.
describe("money formatting", () => {
  it("convierte unidades menores a mayores sin perder precisión", () => {
    expect(minorToMajor(500_000)).toBe(5000);
    expect(minorToMajor(1)).toBe(0.01);
  });

  it("redondea correctamente de unidad mayor a menor entera", () => {
    expect(majorToMinor(5000)).toBe(500_000);
    expect(majorToMinor(0.1)).toBe(10);
    // 19.99 * 100 = 1998.9999... en flotante; debe redondear a 1999 entero.
    expect(majorToMinor(19.99)).toBe(1999);
  });

  it("es inverso entre mayor↔menor para montos típicos", () => {
    for (const minor of [0, 1, 99, 100, 123_456, 999_999]) {
      expect(majorToMinor(minorToMajor(minor))).toBe(minor);
    }
  });

  it("formatea con símbolo de moneda y degrada elegantemente con moneda inválida", () => {
    expect(formatMoney(500_000, "COP", "es-CO")).toContain("5.000");
    expect(formatMoney(100, "XXX", "es-CO")).toContain("1");
  });
});
