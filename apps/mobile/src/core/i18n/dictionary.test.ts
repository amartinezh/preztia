import { describe, expect, it } from "vitest";

import { dictionaryEntries, missingTranslations, type MessageKey } from "./index";

/**
 * Especificación (Gherkin):
 *   Dado que el operador puede cambiar la interfaz a português (Brasil)
 *   Cuando se publica una clave nueva en `es`
 *   Entonces pt-BR la trae también (sin textos mezclados) con los mismos `{marcadores}`.
 */
describe("diccionarios", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const es = new Map(dictionaryEntries("es"));

  it("pt-BR cubre todas las claves de es", () => {
    expect(missingTranslations("pt-BR")).toEqual([]);
    expect(missingTranslations("es")).toEqual([]);
  });

  it("pt-BR no tiene claves que es desconozca", () => {
    const extra = dictionaryEntries("pt-BR")
      .map(([key]) => key)
      .filter((key) => !es.has(key));
    expect(extra).toEqual([]);
  });

  it("cada texto pt-BR conserva los marcadores de su original", () => {
    const broken = dictionaryEntries("pt-BR").filter(
      ([key, text]) => JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(es.get(key as MessageKey) ?? "")),
    );
    expect(broken.map(([key]) => key)).toEqual([]);
  });

  it("ningún texto está vacío", () => {
    for (const locale of ["es", "pt-BR"] as const) {
      const empty = dictionaryEntries(locale).filter(([, text]) => text.trim() === "");
      expect(empty).toEqual([]);
    }
  });
});
