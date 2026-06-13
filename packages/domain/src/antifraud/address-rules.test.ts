import { describe, it, expect } from "vitest";
import {
  crossCheckAddressAgainstCep,
  crossCheckPhoneDddAgainstUf,
  extractBrazilianDdd,
  isWellFormedCep,
  type CepRecord,
} from "./address-rules";

const paulista: CepRecord = {
  cep: "01311000",
  state: "SP",
  city: "São Paulo",
  street: "Avenida Paulista",
};

describe("crossCheckAddressAgainstCep", () => {
  it("sin alertas cuando ciudad y UF corresponden al CEP", () => {
    expect(
      crossCheckAddressAgainstCep({ cep: "01311000", ciudad: "Sao Paulo", uf: "sp" }, paulista),
    ).toEqual([]);
  });

  it("CEP inexistente ⇒ ALTA (dirección inventada)", () => {
    const alerts = crossCheckAddressAgainstCep(
      { cep: "99999999", ciudad: null, uf: null },
      null,
    );
    expect(alerts).toEqual([expect.objectContaining({ campo: "cep", severidad: "ALTA" })]);
  });

  it("UF que no corresponde al CEP ⇒ ALTA; ciudad distinta ⇒ MEDIA", () => {
    const alerts = crossCheckAddressAgainstCep(
      { cep: "01311000", ciudad: "Curitiba", uf: "PR" },
      paulista,
    );
    expect(alerts.some((a) => a.campo === "uf" && a.severidad === "ALTA")).toBe(true);
    expect(alerts.some((a) => a.campo === "cidade" && a.severidad === "MEDIA")).toBe(true);
  });
});

describe("extractBrazilianDdd", () => {
  it("extrae el DDD de un E.164 brasileño sin '+'", () => {
    expect(extractBrazilianDdd("5511999998888")).toBe("11");
  });

  it("null para números no brasileños o demasiado cortos", () => {
    expect(extractBrazilianDdd("573001112222")).toBeNull();
    expect(extractBrazilianDdd("5511")).toBeNull();
  });
});

describe("crossCheckPhoneDddAgainstUf", () => {
  it("sin alertas cuando el DDD corresponde a la UF del documento", () => {
    expect(
      crossCheckPhoneDddAgainstUf({ ddd: "11", dddState: "SP", documentUf: "sp" }),
    ).toEqual([]);
  });

  it("DDD de otro estado ⇒ MEDIA (señal débil)", () => {
    const alerts = crossCheckPhoneDddAgainstUf({ ddd: "11", dddState: "SP", documentUf: "RJ" });
    expect(alerts).toEqual([expect.objectContaining({ campo: "ddd", severidad: "MEDIA" })]);
  });
});

describe("isWellFormedCep", () => {
  it("acepta 8 dígitos con o sin guion", () => {
    expect(isWellFormedCep("01311-000")).toBe(true);
    expect(isWellFormedCep("0131100")).toBe(false);
  });
});
