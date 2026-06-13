import { describe, it, expect } from "vitest";
import { isValidCpf, isValidCnpj, onlyDigits } from "./taxpayer-id";

describe("isValidCpf", () => {
  it("acepta CPFs con dígitos verificadores correctos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("40442820135")).toBe(true); // CPF ficticio del trial Serpro
  });

  it("rechaza CPFs con dígito verificador alterado", () => {
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCpf("40442820136")).toBe(false);
  });

  it("rechaza secuencias de un mismo dígito (estructura válida, número inventado)", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
  });

  it("rechaza longitudes incorrectas y vacío", () => {
    expect(isValidCpf("1234567890")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
});

describe("isValidCnpj", () => {
  it("acepta CNPJs con dígitos verificadores correctos", () => {
    expect(isValidCnpj("33.683.111/0002-80")).toBe(true); // Serpro Regional Brasília
  });

  it("rechaza CNPJs con dígito verificador alterado", () => {
    expect(isValidCnpj("33.683.111/0002-81")).toBe(false);
  });

  it("rechaza secuencias de un mismo dígito y longitudes incorrectas", () => {
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("3368311100028")).toBe(false);
  });
});

describe("onlyDigits", () => {
  it("quita puntuación y deja solo dígitos", () => {
    expect(onlyDigits("33.683.111/0002-80")).toBe("33683111000280");
  });
});
