import { describe, it, expect } from "vitest";
import {
  mod10CheckDigit,
  mod11CheckDigit,
  parseLinhaDigitavelConvenio,
  reviewLinhaDigitavel,
} from "./febraban";

/**
 * Construye una línea digitable de convenio VÁLIDA según la estructura FEBRABAN:
 * código de barras = '8' + segmento + idValor + DVgeneral + valor(11) + empresa(4)
 * + campo libre(25); la línea agrega un DV al final de cada bloque de 11.
 */
function buildLinha(input: {
  segmento: string;
  idValor: "6" | "8";
  valorMinor: number;
  empresa?: string;
}): string {
  const dvOf = input.idValor === "6" ? mod10CheckDigit : mod11CheckDigit;
  const valor = String(input.valorMinor).padStart(11, "0");
  const empresa = input.empresa ?? "0001";
  const campoLibre = "0".repeat(25);
  const sinDvGeneral = `8${input.segmento}${input.idValor}${valor}${empresa}${campoLibre}`;
  const dvGeneral = dvOf(sinDvGeneral);
  const barcode = `8${input.segmento}${input.idValor}${dvGeneral}${valor}${empresa}${campoLibre}`;
  let linha = "";
  for (let block = 0; block < 4; block++) {
    const data = barcode.slice(block * 11, block * 11 + 11);
    linha += data + dvOf(data);
  }
  return linha;
}

describe("parseLinhaDigitavelConvenio", () => {
  it("decodifica segmento, valor y empresa de una línea válida (módulo 10)", () => {
    const linha = buildLinha({ segmento: "3", idValor: "6", valorMinor: 18750, empresa: "0123" });
    const res = parseLinhaDigitavelConvenio(linha);
    expect(res).toEqual({
      valida: true,
      dados: { segmento: 3, valorMinor: 18750, empresa: "0123" },
    });
  });

  it("decodifica una línea válida con DV módulo 11", () => {
    const linha = buildLinha({ segmento: "2", idValor: "8", valorMinor: 9990 });
    const res = parseLinhaDigitavelConvenio(linha);
    expect(res.valida).toBe(true);
    if (res.valida) expect(res.dados.valorMinor).toBe(9990);
  });

  it("rechaza una línea con un dígito alterado (DV de bloque no coincide)", () => {
    const linha = buildLinha({ segmento: "3", idValor: "6", valorMinor: 18750 });
    const adulterada = `${linha.slice(0, 5)}${linha[5] === "9" ? "0" : "9"}${linha.slice(6)}`;
    expect(parseLinhaDigitavelConvenio(adulterada).valida).toBe(false);
  });

  it("rechaza longitudes distintas de 48 y líneas que no inician con 8", () => {
    expect(parseLinhaDigitavelConvenio("123").valida).toBe(false);
    const linha = buildLinha({ segmento: "3", idValor: "6", valorMinor: 100 });
    expect(parseLinhaDigitavelConvenio(`7${linha.slice(1)}`).valida).toBe(false);
  });
});

describe("reviewLinhaDigitavel", () => {
  it("INVARIANTE: valor impreso distinto del codificado ⇒ alerta CRITICA", () => {
    const linha = buildLinha({ segmento: "3", idValor: "6", valorMinor: 18750 });
    const alerts = reviewLinhaDigitavel({ linha, valorImpresoMinor: 25000 });
    expect(alerts.some((a) => a.campo === "valor" && a.severidad === "CRITICA")).toBe(true);
  });

  it("sin alertas cuando el valor impreso coincide y el segmento es de servicio público", () => {
    const linha = buildLinha({ segmento: "3", idValor: "6", valorMinor: 18750 });
    expect(reviewLinhaDigitavel({ linha, valorImpresoMinor: 18750 })).toEqual([]);
  });

  it("línea inválida ⇒ alerta ALTA", () => {
    const alerts = reviewLinhaDigitavel({ linha: "8".repeat(48), valorImpresoMinor: null });
    expect(alerts.some((a) => a.severidad === "ALTA")).toBe(true);
  });

  it("segmento que no es de servicio público ⇒ alerta MEDIA", () => {
    const linha = buildLinha({ segmento: "1", idValor: "6", valorMinor: 100 });
    const alerts = reviewLinhaDigitavel({ linha, valorImpresoMinor: 100 });
    expect(alerts.some((a) => a.severidad === "MEDIA")).toBe(true);
  });
});
