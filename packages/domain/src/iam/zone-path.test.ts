import { describe, it, expect } from "vitest";
import {
  allWithinScope,
  assertValidLabel,
  buildChildPath,
  isWithinScope,
  toLabel,
} from "./zone-path";
import { DomainError } from "../shared/money";

describe("buildChildPath", () => {
  it("una zona raíz tiene como ruta su propia etiqueta", () => {
    expect(buildChildPath(null, "antioquia")).toBe("antioquia");
  });

  it("una zona hija concatena la ruta del padre", () => {
    expect(buildChildPath("co.antioquia", "medellin")).toBe("co.antioquia.medellin");
  });

  it("rechaza etiquetas que no son labels ltree", () => {
    expect(() => buildChildPath(null, "Medellín")).toThrow(DomainError);
    expect(() => buildChildPath(null, "con espacio")).toThrow(DomainError);
    expect(() => buildChildPath("ruta-invalida", "x")).toThrow(DomainError);
  });
});

describe("toLabel", () => {
  it("normaliza nombres legibles a labels ltree estables", () => {
    expect(toLabel("Medellín")).toBe("medellin");
    expect(toLabel("Zona Norte 2")).toBe("zona_norte_2");
  });

  it("rechaza nombres sin caracteres alfanuméricos", () => {
    expect(() => toLabel("///")).toThrow(DomainError);
  });
});

describe("isWithinScope", () => {
  it("incluye el propio scope y sus descendientes", () => {
    expect(isWithinScope("co.antioquia", ["co.antioquia"])).toBe(true);
    expect(isWithinScope("co.antioquia.medellin", ["co.antioquia"])).toBe(true);
  });

  it("excluye ancestros, hermanos y prefijos parciales", () => {
    expect(isWithinScope("co", ["co.antioquia"])).toBe(false);
    expect(isWithinScope("co.valle", ["co.antioquia"])).toBe(false);
    expect(isWithinScope("co.antioquia2", ["co.antioquia"])).toBe(false);
  });

  it("sin scopes asignados no ve ninguna zona", () => {
    expect(isWithinScope("co.antioquia", [])).toBe(false);
  });

  it("allWithinScope exige que TODAS las rutas caigan en el scope", () => {
    const scopes = ["co.antioquia"];
    expect(allWithinScope(["co.antioquia.medellin", "co.antioquia.bello"], scopes)).toBe(true);
    expect(allWithinScope(["co.antioquia.medellin", "co.valle.cali"], scopes)).toBe(false);
  });
});

describe("assertValidLabel", () => {
  it("acepta labels ltree y rechaza el resto", () => {
    expect(() => assertValidLabel("medellin_2")).not.toThrow();
    expect(() => assertValidLabel("Medellin")).toThrow(DomainError);
    expect(() => assertValidLabel("")).toThrow(DomainError);
  });
});
