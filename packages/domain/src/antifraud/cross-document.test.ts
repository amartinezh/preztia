import { describe, it, expect } from "vitest";
import { crossCheckDocumentCoherence } from "./cross-document";

describe("crossCheckDocumentCoherence", () => {
  const coherente = {
    identidadNombre: "JOAO DA SILVA",
    titularRecibo: "João da Silva",
    sociosNegocio: ["JOAO DA SILVA SANTOS"],
  };

  it("sin alertas cuando identidad, recibo y QSA cuentan la misma historia", () => {
    expect(crossCheckDocumentCoherence(coherente)).toEqual([]);
  });

  it("solicitante ausente del QSA ⇒ ALTA (sin poderes aparentes)", () => {
    const alerts = crossCheckDocumentCoherence({
      ...coherente,
      identidadNombre: "PEDRO ALMEIDA COSTA",
      titularRecibo: null,
    });
    expect(alerts.some((a) => a.campo === "qsa" && a.severidad === "ALTA")).toBe(true);
  });

  it("titular del recibo sin relación con solicitante ni socios ⇒ MEDIA", () => {
    const alerts = crossCheckDocumentCoherence({
      ...coherente,
      titularRecibo: "TERCERO SIN RELACION",
    });
    expect(alerts.some((a) => a.campo === "titular" && a.severidad === "MEDIA")).toBe(true);
  });

  it("acepta el recibo a nombre de un socio (no necesariamente el solicitante)", () => {
    const alerts = crossCheckDocumentCoherence({
      identidadNombre: "JOAO DA SILVA SANTOS",
      titularRecibo: "MARIA OLIVEIRA",
      sociosNegocio: ["JOAO DA SILVA SANTOS", "MARIA OLIVEIRA"],
    });
    expect(alerts).toEqual([]);
  });

  it("sin datos suficientes ⇒ sin alertas (no inventa señales)", () => {
    expect(
      crossCheckDocumentCoherence({
        identidadNombre: null,
        titularRecibo: null,
        sociosNegocio: [],
      }),
    ).toEqual([]);
  });
});
