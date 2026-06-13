import { describe, it, expect } from "vitest";
import { alerta } from "./alert";
import { scoreValidation } from "./scoring";

describe("scoreValidation", () => {
  it("sin alertas ⇒ approved con score 0", () => {
    expect(scoreValidation([])).toEqual({ status: "approved", score: 0 });
  });

  it("INVARIANTE: cualquier alerta CRITICA ⇒ rejected, aunque sea la única", () => {
    const verdict = scoreValidation([alerta("valor", "CRITICA", "monto adulterado")]);
    expect(verdict.status).toBe("rejected");
  });

  it("INVARIANTE: cualquier alerta ALTA ⇒ al menos suspicious", () => {
    const verdict = scoreValidation([alerta("cpf", "ALTA", "dígito inválido")]);
    expect(verdict.status).toBe("suspicious");
  });

  it("anomalías menores acumuladas alcanzan el umbral de sospecha", () => {
    const dosMedias = [alerta("cep", "MEDIA", "x"), alerta("uf", "MEDIA", "y")];
    expect(scoreValidation(dosMedias).status).toBe("suspicious");
  });

  it("una sola alerta MEDIA o BAJA no bloquea la aprobación", () => {
    expect(scoreValidation([alerta("cep", "MEDIA", "x")]).status).toBe("approved");
    expect(scoreValidation([alerta("fuente", "BAJA", "x")]).status).toBe("approved");
  });

  it("el score queda acotado a 100", () => {
    const muchas = Array.from({ length: 5 }, (_, i) => alerta(`c${i}`, "CRITICA", "x"));
    expect(scoreValidation(muchas).score).toBe(100);
  });
});
