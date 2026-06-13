import { describe, it, expect } from "vitest";
import { mod10CheckDigit } from "./febraban";
import {
  crossCheckUtilityIssuerAgainstRegistry,
  reviewUtilityReceipt,
  type UtilityReceiptFields,
} from "./utility-rules";
import { type CnpjRegistryRecord } from "./business-rules";

const HOY = new Date("2026-06-12T00:00:00Z");

// Línea digitable de energía (segmento 3, módulo 10) con valor 18750 centavos.
function linhaEnergia(valorMinor: number): string {
  const valor = String(valorMinor).padStart(11, "0");
  const sinDv = `836${valor}${"0001"}${"0".repeat(25)}`;
  const dvGeneral = mod10CheckDigit(sinDv);
  const barcode = `836${dvGeneral}${valor}${"0001"}${"0".repeat(25)}`;
  let linha = "";
  for (let block = 0; block < 4; block++) {
    const data = barcode.slice(block * 11, block * 11 + 11);
    linha += data + mod10CheckDigit(data);
  }
  return linha;
}

const recibo: UtilityReceiptFields = {
  titular: "JOAO DA SILVA",
  cnpjEmisor: "33.683.111/0002-80",
  cep: "70836900",
  ciudad: "BRASILIA",
  uf: "DF",
  fechaEmision: "2026-05-20",
  mesReferencia: "2026-05-01",
  vencimiento: "2026-06-05",
  valorMinor: 18750,
  lineaDigitable: linhaEnergia(18750),
};

describe("reviewUtilityReceipt", () => {
  it("sin alertas para un recibo reciente y coherente", () => {
    expect(reviewUtilityReceipt(recibo, HOY)).toEqual([]);
  });

  it("comprobante con más de 90 días ⇒ ALTA", () => {
    const alerts = reviewUtilityReceipt({ ...recibo, fechaEmision: "2026-01-10" }, HOY);
    expect(alerts.some((a) => a.campo === "data_emissao" && a.severidad === "ALTA")).toBe(true);
  });

  it("INVARIANTE: valor impreso ≠ valor del código de barras ⇒ CRITICA", () => {
    const alerts = reviewUtilityReceipt({ ...recibo, valorMinor: 9900 }, HOY);
    expect(alerts.some((a) => a.campo === "valor" && a.severidad === "CRITICA")).toBe(true);
  });

  it("vencimiento anterior al mes de referencia ⇒ MEDIA", () => {
    const alerts = reviewUtilityReceipt({ ...recibo, vencimiento: "2026-04-01" }, HOY);
    expect(alerts.some((a) => a.campo === "vencimento" && a.severidad === "MEDIA")).toBe(true);
  });

  it("CNPJ del emisor inválido ⇒ ALTA", () => {
    const alerts = reviewUtilityReceipt({ ...recibo, cnpjEmisor: "11111111111111" }, HOY);
    expect(alerts.some((a) => a.campo === "cnpj_emissor" && a.severidad === "ALTA")).toBe(true);
  });

  it("fecha de emisión ilegible ⇒ MEDIA (no bloquea)", () => {
    const alerts = reviewUtilityReceipt({ ...recibo, fechaEmision: null }, HOY);
    expect(alerts).toEqual([
      expect.objectContaining({ campo: "data_emissao", severidad: "MEDIA" }),
    ]);
  });
});

describe("crossCheckUtilityIssuerAgainstRegistry", () => {
  const distribuidora: CnpjRegistryRecord = {
    cnpj: "33683111000280",
    razonSocial: "ENEL DISTRIBUICAO SAO PAULO",
    situacionCadastral: "ATIVA",
    fechaInicioActividad: "1998-01-01",
    cnaeFiscal: "3514000", // distribución de energía eléctrica
    cnaeDescripcion: "Distribuição de energia elétrica",
    municipio: "SAO PAULO",
    uf: "SP",
    cep: "01311000",
    capitalSocialMinor: null,
    socios: [],
  };

  it("sin alertas para una distribuidora activa del sector", () => {
    expect(crossCheckUtilityIssuerAgainstRegistry(distribuidora)).toEqual([]);
  });

  it("INVARIANTE: 'factura de luz' emitida por CNAE de otro rubro ⇒ CRITICA", () => {
    const alerts = crossCheckUtilityIssuerAgainstRegistry({
      ...distribuidora,
      cnaeFiscal: "4711301", // comercio varejista
      cnaeDescripcion: "Comércio varejista",
    });
    expect(alerts.some((a) => a.campo === "cnae_fiscal" && a.severidad === "CRITICA")).toBe(true);
  });

  it("emisor inactivo en la Receita ⇒ ALTA", () => {
    const alerts = crossCheckUtilityIssuerAgainstRegistry({
      ...distribuidora,
      situacionCadastral: "BAIXADA",
    });
    expect(alerts.some((a) => a.severidad === "ALTA")).toBe(true);
  });

  it("acepta telecomunicaciones (CNAE 61) como servicio público", () => {
    const alerts = crossCheckUtilityIssuerAgainstRegistry({
      ...distribuidora,
      cnaeFiscal: "6110801",
    });
    expect(alerts).toEqual([]);
  });
});
