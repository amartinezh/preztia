import { describe, expect, it } from "vitest";
import { formatMoney, majorToMinor, minorToMajor, parseMoneyInput } from "./money";

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

/**
 * Especificación (Gherkin):
 *   Dado que un cobrador teclea un monto como lo escribe en la región (punto de miles, coma decimal)
 *   Cuando la app lo lee
 *   Entonces obtiene el entero en unidades menores exacto
 *   Y cualquier texto ambiguo o inválido se rechaza (null) en vez de convertirse en silencio.
 */
describe("parseMoneyInput", () => {
  it("lee enteros con y sin separador de miles", () => {
    expect(parseMoneyInput("20000")).toBe(2_000_000);
    expect(parseMoneyInput("20.000")).toBe(2_000_000);
    expect(parseMoneyInput("1.500.000")).toBe(150_000_000);
    expect(parseMoneyInput("20 000")).toBe(2_000_000);
    expect(parseMoneyInput("0")).toBe(0);
  });

  it("lee decimales con coma y completa los centavos", () => {
    expect(parseMoneyInput("1500000,50")).toBe(150_000_050);
    expect(parseMoneyInput("1.500,5")).toBe(150_050);
    expect(parseMoneyInput("1,5")).toBe(150);
  });

  it("tolera símbolo de moneda y espacios alrededor", () => {
    expect(parseMoneyInput(" R$ 1.200 ")).toBe(120_000);
    expect(parseMoneyInput("COP 20.000")).toBe(2_000_000);
    expect(parseMoneyInput("$ 350")).toBe(35_000);
  });

  it("rechaza lo ambiguo o inválido en vez de convertirlo en silencio", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("   ")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("1.5")).toBeNull(); // punto sin grupo de tres: ¿1,5 o 15?
    expect(parseMoneyInput("1.50")).toBeNull();
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("1,2,3")).toBeNull();
    expect(parseMoneyInput("1,234")).toBeNull(); // más decimales que la moneda
    expect(parseMoneyInput("12.34.5")).toBeNull();
  });

  it("nunca devuelve NaN y respeta los decimales de la moneda", () => {
    expect(parseMoneyInput("1,5", 0)).toBeNull();
    expect(parseMoneyInput("1500", 0)).toBe(1500);
    expect(Number.isNaN(parseMoneyInput("x") ?? 0)).toBe(false);
  });

  it("es inverso del formateo plano para enteros no negativos", () => {
    for (const minor of [0, 1, 99, 100, 123_456, 999_999, 150_000_050]) {
      const plain = minorToMajor(minor).toFixed(2).replace(".", ",");
      expect(parseMoneyInput(plain)).toBe(minor);
    }
  });
});
