import { describe, it, expect } from "vitest";
import type { CepRecord, CnpjRegistryRecord, CpfRegistryRecord } from "@preztiaos/domain";
import type {
  DocumentValidationReport,
  PersistedDocumentExtraction,
} from "./ports";
import { ValidateApplicationDocumentsHandler } from "./validate-application-documents";

// ─── Fakes de los puertos (sin I/O) ───

const HOY = () => new Date("2026-06-12T00:00:00Z");
const CMD = { tenantId: "t-1", applicationId: "a-1" };

const registroNegocio: CnpjRegistryRecord = {
  cnpj: "33683111000280",
  razonSocial: "PADARIA DO JOAO LTDA",
  situacionCadastral: "ATIVA",
  fechaInicioActividad: "2018-01-15",
  cnaeFiscal: "4721102",
  cnaeDescripcion: "Padaria e confeitaria",
  municipio: "BRASILIA",
  uf: "DF",
  cep: "70836900",
  capitalSocialMinor: 5_000_000,
  socios: ["JOAO DA SILVA"],
};

const distribuidora: CnpjRegistryRecord = {
  ...registroNegocio,
  cnpj: "33683111000360", // filial ficticia (DV válido) para el emisor del recibo
  razonSocial: "ENEL DISTRIBUICAO",
  cnaeFiscal: "3514000",
  cnaeDescripcion: "Distribuição de energia elétrica",
  socios: [],
};

// Enruta por CNPJ: el del negocio devuelve la padaria; el del emisor, la distribuidora.
const cnpjPorDefecto = async (cnpj: string) =>
  cnpj === "33683111000280" ? registroNegocio : distribuidora;

const cepBrasilia: CepRecord = {
  cep: "70836900",
  state: "DF",
  city: "Brasília",
  street: null,
};

const identidad: PersistedDocumentExtraction = {
  documentType: "IDENTITY_DOCUMENT",
  applicantPhone: "5561999998888",
  fields: {
    nome: "JOAO DA SILVA",
    cpf: "529.982.247-25",
    data_nascimento: "1985-03-15",
    data_emissao: "2020-06-20",
    validade: "2030-06-20",
  },
  fileMetadata: null,
};

const negocio: PersistedDocumentExtraction = {
  documentType: "BUSINESS_VALIDITY_CERTIFICATE",
  applicantPhone: "5561999998888",
  fields: {
    razao_social: "PADARIA DO JOAO LTDA",
    cnpj: "33.683.111/0002-80",
    capital_social: "R$ 50.000,00",
    qsa: [{ nome_socio: "JOAO DA SILVA" }],
    cep: "70836900",
    uf: "DF",
  },
  fileMetadata: null,
};

const recibo: PersistedDocumentExtraction = {
  documentType: "PUBLIC_SERVICES_RECEIPT",
  applicantPhone: "5561999998888",
  fields: {
    titular: "JOAO DA SILVA",
    cnpj_emissor: "33.683.111/0003-60",
    cep: "70836900",
    cidade: "Brasília",
    uf: "DF",
    data_emissao: "2026-05-20",
    valor: "187,50",
  },
  fileMetadata: null,
};

// La foto del local se persiste como extracción BUSINESS_PHOTO con el veredicto de visión.
const fotoNegocio: PersistedDocumentExtraction = {
  documentType: "BUSINESS_PHOTO",
  applicantPhone: "5561999998888",
  fields: {
    riskLevel: "LOW",
    veracityScore: 90,
    matchesRegistry: true,
    inconsistencies: [],
    summary: "Local coherente con el registro.",
  },
  fileMetadata: null,
};

interface Overrides {
  extractions?: readonly PersistedDocumentExtraction[];
  cnpj?: (cnpj: string) => Promise<CnpjRegistryRecord | null>;
  cep?: (cep: string) => Promise<CepRecord | null>;
  cpf?: (cpf: string) => Promise<CpfRegistryRecord | null>;
}

function makeHandler(over: Overrides = {}) {
  const saved: DocumentValidationReport[] = [];
  const handler = new ValidateApplicationDocumentsHandler(
    { findLatestByApplication: async () => over.extractions ?? [identidad, negocio, recibo, fotoNegocio] },
    { findByCnpj: over.cnpj ?? cnpjPorDefecto },
    { findByCep: over.cep ?? (async () => cepBrasilia) },
    { findByDdd: async () => ({ state: "DF" }) },
    { verify: over.cpf ?? (async () => null) }, // Serpro no contratado por defecto
    { save: async (report) => void saved.push(report) },
    HOY,
  );
  return { handler, saved };
}

describe("ValidateApplicationDocumentsHandler", () => {
  it("aprueba una solicitud con los tres documentos coherentes y persiste el reporte", async () => {
    const { handler, saved } = makeHandler();
    const report = await handler.execute(CMD);
    expect(report.status).toBe("approved");
    expect(report.alerts).toEqual([]);
    expect(report.consultedSources).toEqual(
      expect.arrayContaining(["cnpj-rfb", "cep", "ddd"]),
    );
    expect(saved).toEqual([report]); // el reporte queda persistido (auditabilidad)
  });

  it("INVARIANTE: CNPJ no ATIVA en la Receita ⇒ nunca aprobado", async () => {
    const { handler } = makeHandler({
      cnpj: async (cnpj) =>
        cnpj === "33683111000280"
          ? { ...registroNegocio, situacionCadastral: "BAIXADA" }
          : distribuidora,
    });
    const report = await handler.execute(CMD);
    expect(report.status).toBe("rejected");
    expect(
      report.alerts.some((a) => a.campo === "situacao_cadastral" && a.severidad === "CRITICA"),
    ).toBe(true);
  });

  it("CNPJ inexistente en la fuente (respondió null) ⇒ CRITICA", async () => {
    const { handler } = makeHandler({ cnpj: async () => null });
    const report = await handler.execute(CMD);
    expect(report.status).toBe("rejected");
    expect(report.alerts.some((a) => a.campo === "cnpj" && a.severidad === "CRITICA")).toBe(true);
  });

  it("fuente externa caída ⇒ degradación elegante: alerta BAJA y el pipeline continúa", async () => {
    const { handler } = makeHandler({
      cnpj: async () => {
        throw new Error("timeout");
      },
    });
    const report = await handler.execute(CMD);
    expect(report.alerts.some((a) => a.campo === "fuente_externa" && a.severidad === "BAJA")).toBe(
      true,
    );
    // Sin señal CRITICA inventada por la caída.
    expect(report.alerts.every((a) => a.severidad !== "CRITICA")).toBe(true);
  });

  it("extracciones faltantes ⇒ alerta MEDIA por documento y revisión humana", async () => {
    const { handler } = makeHandler({ extractions: [identidad] });
    const report = await handler.execute(CMD);
    const faltantes = report.alerts.filter((a) => a.campo === "extraccion");
    expect(faltantes).toHaveLength(3);
    expect(report.status).toBe("suspicious");
  });

  it("Etapa 4: con Serpro configurado, un nombre distinto al de la RFB ⇒ rejected", async () => {
    const { handler } = makeHandler({
      cpf: async () => ({
        nombre: "OUTRA PESSOA QUALQUER",
        nacimiento: "1990-01-01",
        situacion: "Regular",
      }),
    });
    const report = await handler.execute(CMD);
    expect(report.status).toBe("rejected");
    expect(report.consultedSources).toContain("cpf-rfb");
  });

  it("atribuye cada alerta al documento que la originó", async () => {
    const { handler } = makeHandler({
      cnpj: async (cnpj) =>
        cnpj === "33683111000280" ? { ...registroNegocio, capitalSocialMinor: 1 } : distribuidora,
    });
    const report = await handler.execute(CMD);
    const capital = report.alerts.find((a) => a.campo === "capital_social");
    expect(capital?.documento).toBe("BUSINESS_VALIDITY_CERTIFICATE");
  });
});
