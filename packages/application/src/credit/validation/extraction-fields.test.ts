import { describe, it, expect } from "vitest";
import {
  mapBusinessFields,
  mapIdentityFields,
  mapUtilityFields,
  toIsoDate,
  toMinorUnits,
  toPartnerNames,
} from "./extraction-fields";

describe("toIsoDate", () => {
  it("acepta ISO, dd/mm/aaaa y mm/aaaa (mes de referencia)", () => {
    expect(toIsoDate("1985-03-15")).toBe("1985-03-15");
    expect(toIsoDate("15/03/1985")).toBe("1985-03-15");
    expect(toIsoDate("05/2026")).toBe("2026-05-01");
    expect(toIsoDate("2026-05")).toBe("2026-05-01");
  });

  it("null para valores no interpretables", () => {
    expect(toIsoDate("mañana")).toBeNull();
    expect(toIsoDate(42)).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe("toMinorUnits", () => {
  it("convierte montos brasileños e internacionales a centavos enteros", () => {
    expect(toMinorUnits("R$ 1.234,56")).toBe(123456);
    expect(toMinorUnits("187,50")).toBe(18750);
    expect(toMinorUnits("1234.56")).toBe(123456);
    expect(toMinorUnits(187.5)).toBe(18750);
  });

  it("null para valores no numéricos", () => {
    expect(toMinorUnits("gratis")).toBeNull();
    expect(toMinorUnits(undefined)).toBeNull();
  });
});

describe("toPartnerNames", () => {
  it("acepta arrays de strings y de objetos con distintas claves", () => {
    expect(toPartnerNames(["JOAO DA SILVA"])).toEqual(["JOAO DA SILVA"]);
    expect(
      toPartnerNames([{ nome_socio: "MARIA" }, { nome: "PEDRO" }, { otro: "x" }]),
    ).toEqual(["MARIA", "PEDRO"]);
  });
});

describe("mapeo por categoría", () => {
  it("identidad: tolera alias en portugués y fechas brasileñas", () => {
    const mapped = mapIdentityFields({
      Nome: "JOAO DA SILVA",
      CPF: "529.982.247-25",
      "Data de Nascimento": "15/03/1985",
      validade: "2030-06-20",
    });
    expect(mapped).toEqual({
      nombre: "JOAO DA SILVA",
      cpf: "529.982.247-25",
      fechaNacimiento: "1985-03-15",
      fechaEmision: null,
      fechaValidez: "2030-06-20",
    });
  });

  it("negocio: capital social a centavos y QSA a nombres", () => {
    const mapped = mapBusinessFields({
      razao_social: "PADARIA LTDA",
      cnpj: "33.683.111/0002-80",
      capital_social: "R$ 50.000,00",
      qsa: [{ nome_socio: "JOAO DA SILVA" }],
      uf: "DF",
    });
    expect(mapped.capitalSocialMinor).toBe(5_000_000);
    expect(mapped.socios).toEqual(["JOAO DA SILVA"]);
  });

  it("recibo: valor impreso a centavos y mes de referencia a ISO", () => {
    const mapped = mapUtilityFields({
      titular: "JOAO DA SILVA",
      cnpj_emissor: "33683111000280",
      valor_total: "187,50",
      mes_referencia: "05/2026",
      vencimento: "05/06/2026",
    });
    expect(mapped.valorMinor).toBe(18750);
    expect(mapped.mesReferencia).toBe("2026-05-01");
    expect(mapped.vencimiento).toBe("2026-06-05");
  });
});
