import { describe, it, expect } from "vitest";
import {
  crossCheckBusinessAgainstRegistry,
  reviewBusinessDocument,
  type BusinessDocumentFields,
  type CnpjRegistryRecord,
} from "./business-rules";
import { scoreValidation } from "./scoring";

const HOY = new Date("2026-06-12T00:00:00Z");

const documento: BusinessDocumentFields = {
  razonSocial: "PADARIA DO JOAO LTDA",
  cnpj: "33.683.111/0002-80",
  capitalSocialMinor: 5_000_000, // R$ 50.000,00
  socios: ["JOAO DA SILVA"],
  cep: "70836900",
  uf: "DF",
};

const registro: CnpjRegistryRecord = {
  cnpj: "33683111000280",
  razonSocial: "PADARIA DO JOAO LTDA",
  situacionCadastral: "ATIVA",
  fechaInicioActividad: "2018-01-15",
  cnaeFiscal: "4721102",
  cnaeDescripcion: "Padaria e confeitaria",
  municipio: "BRASILIA",
  uf: "DF",
  cep: "70836-900",
  capitalSocialMinor: 5_000_000,
  socios: ["JOAO DA SILVA SANTOS"],
};

describe("reviewBusinessDocument", () => {
  it("sin alertas con CNPJ válido", () => {
    expect(reviewBusinessDocument(documento)).toEqual([]);
  });

  it("CNPJ inválido ⇒ ALTA; ilegible ⇒ MEDIA", () => {
    expect(
      reviewBusinessDocument({ ...documento, cnpj: "11111111111111" })[0]?.severidad,
    ).toBe("ALTA");
    expect(reviewBusinessDocument({ ...documento, cnpj: null })[0]?.severidad).toBe("MEDIA");
  });
});

describe("crossCheckBusinessAgainstRegistry", () => {
  it("sin alertas cuando todo coincide con la Receita", () => {
    expect(crossCheckBusinessAgainstRegistry(documento, registro, HOY)).toEqual([]);
  });

  it("INVARIANTE: situación cadastral distinta de ATIVA ⇒ CRITICA y nunca aprobado", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      documento,
      { ...registro, situacionCadastral: "BAIXADA" },
      HOY,
    );
    expect(alerts.some((a) => a.campo === "situacao_cadastral" && a.severidad === "CRITICA")).toBe(
      true,
    );
    expect(scoreValidation(alerts).status).toBe("rejected");
  });

  it("INVARIANTE: socio del documento ausente en el QSA oficial ⇒ CRITICA", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      { ...documento, socios: ["JOAO DA SILVA", "SOCIO FANTASMA INVENTADO"] },
      registro,
      HOY,
    );
    expect(alerts.some((a) => a.campo === "qsa" && a.severidad === "CRITICA")).toBe(true);
  });

  it("capital social inflado ⇒ MEDIA", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      { ...documento, capitalSocialMinor: 100_000_000 },
      registro,
      HOY,
    );
    expect(alerts.some((a) => a.campo === "capital_social" && a.severidad === "MEDIA")).toBe(true);
  });

  it("razón social distinta ⇒ ALTA", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      { ...documento, razonSocial: "OTRA EMPRESA SA" },
      registro,
      HOY,
    );
    expect(alerts.some((a) => a.campo === "razao_social" && a.severidad === "ALTA")).toBe(true);
  });

  it("CEP o UF distintos de la Receita ⇒ MEDIA", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      { ...documento, cep: "01311000", uf: "SP" },
      registro,
      HOY,
    );
    expect(alerts.filter((a) => a.severidad === "MEDIA")).toHaveLength(2);
  });

  it("negocio con menos de 6 meses ⇒ MEDIA (escalar a EDD)", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      documento,
      { ...registro, fechaInicioActividad: "2026-03-01" },
      HOY,
    );
    expect(
      alerts.some((a) => a.campo === "data_inicio_atividade" && a.severidad === "MEDIA"),
    ).toBe(true);
  });

  it("no exige QSA cuando la fuente no publica socios (MEI)", () => {
    const alerts = crossCheckBusinessAgainstRegistry(
      documento,
      { ...registro, socios: [] },
      HOY,
    );
    expect(alerts.every((a) => a.campo !== "qsa")).toBe(true);
  });
});
