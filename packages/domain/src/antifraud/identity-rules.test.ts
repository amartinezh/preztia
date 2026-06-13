import { describe, it, expect } from "vitest";
import {
  crossCheckIdentityAgainstCpfRegistry,
  reviewIdentityDocument,
  type CpfRegistryRecord,
  type IdentityDocumentFields,
} from "./identity-rules";

const HOY = new Date("2026-06-12T00:00:00Z");

const identidadValida: IdentityDocumentFields = {
  nombre: "JOAO DA SILVA",
  cpf: "529.982.247-25",
  fechaNacimiento: "1985-03-15",
  fechaEmision: "2020-06-20",
  fechaValidez: "2030-06-20",
};

describe("reviewIdentityDocument", () => {
  it("sin alertas para un documento coherente con CPF válido", () => {
    expect(reviewIdentityDocument(identidadValida, HOY)).toEqual([]);
  });

  it("CPF con dígito verificador inválido ⇒ ALTA", () => {
    const alerts = reviewIdentityDocument({ ...identidadValida, cpf: "12345678900" }, HOY);
    expect(alerts.some((a) => a.campo === "cpf" && a.severidad === "ALTA")).toBe(true);
  });

  it("CPF ilegible ⇒ MEDIA (no se castiga como fraude)", () => {
    const alerts = reviewIdentityDocument({ ...identidadValida, cpf: null }, HOY);
    expect(alerts).toEqual([
      expect.objectContaining({ campo: "cpf", severidad: "MEDIA" }),
    ]);
  });

  it("emisión anterior al nacimiento ⇒ ALTA", () => {
    const alerts = reviewIdentityDocument(
      { ...identidadValida, fechaEmision: "1980-01-01" },
      HOY,
    );
    expect(alerts.some((a) => a.campo === "fecha_emision" && a.severidad === "ALTA")).toBe(true);
  });

  it("emisión futura ⇒ ALTA", () => {
    const alerts = reviewIdentityDocument(
      { ...identidadValida, fechaEmision: "2027-01-01" },
      HOY,
    );
    expect(alerts.some((a) => a.campo === "fecha_emision" && a.severidad === "ALTA")).toBe(true);
  });

  it("menor de 18 años ⇒ ALTA (no puede ser representante legal)", () => {
    const alerts = reviewIdentityDocument(
      { ...identidadValida, fechaNacimiento: "2010-01-01", fechaEmision: "2025-01-01" },
      HOY,
    );
    expect(alerts.some((a) => a.campo === "fecha_nacimiento" && a.severidad === "ALTA")).toBe(
      true,
    );
  });

  it("documento vencido (CNH) ⇒ MEDIA", () => {
    const alerts = reviewIdentityDocument({ ...identidadValida, fechaValidez: "2024-01-01" }, HOY);
    expect(alerts.some((a) => a.campo === "validade" && a.severidad === "MEDIA")).toBe(true);
  });
});

describe("crossCheckIdentityAgainstCpfRegistry", () => {
  const registroRegular: CpfRegistryRecord = {
    nombre: "JOAO DA SILVA",
    nacimiento: "1985-03-15",
    situacion: "Regular",
  };

  it("sin alertas cuando nombre, nacimiento y situación coinciden", () => {
    expect(crossCheckIdentityAgainstCpfRegistry(identidadValida, registroRegular)).toEqual([]);
  });

  it("INVARIANTE: nombre distinto al de la Receita ⇒ CRITICA (fraude probable)", () => {
    const alerts = crossCheckIdentityAgainstCpfRegistry(identidadValida, {
      ...registroRegular,
      nombre: "MARIA OLIVEIRA COSTA",
    });
    expect(alerts.some((a) => a.campo === "nombre" && a.severidad === "CRITICA")).toBe(true);
  });

  it("CPF de persona fallecida o cancelado ⇒ CRITICA", () => {
    const alerts = crossCheckIdentityAgainstCpfRegistry(identidadValida, {
      ...registroRegular,
      situacion: "Titular Falecido",
    });
    expect(alerts.some((a) => a.severidad === "CRITICA")).toBe(true);
  });

  it("situación suspensa ⇒ ALTA", () => {
    const alerts = crossCheckIdentityAgainstCpfRegistry(identidadValida, {
      ...registroRegular,
      situacion: "Suspensa",
    });
    expect(alerts.some((a) => a.severidad === "ALTA")).toBe(true);
  });

  it("acepta variaciones de acentos y apellidos parciales del mismo nombre", () => {
    const alerts = crossCheckIdentityAgainstCpfRegistry(
      { ...identidadValida, nombre: "João da Silva" },
      { ...registroRegular, nombre: "JOAO DA SILVA SANTOS" },
    );
    expect(alerts).toEqual([]);
  });
});
