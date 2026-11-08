import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installZodErrorMap } from "./zod-error-map";

/**
 * Especificación (Gherkin):
 *   Dado que un esquema del contrato no define mensajes propios
 *   Cuando una entrada no cumple la validación
 *   Entonces el mensaje mostrado está en español y describe qué corregir.
 */
describe("mapa de errores de zod en español", () => {
  installZodErrorMap();

  const firstMessage = (schema: z.ZodTypeAny, value: unknown) =>
    schema.safeParse(value).error?.issues[0]?.message;

  it("traduce los casos típicos de los contratos de dinero", () => {
    expect(firstMessage(z.number().int().positive(), 0)).toBe("Debe ser mayor que 0");
    expect(firstMessage(z.number().int().positive(), Number.NaN)).toBe("Ingresa un número válido");
    expect(firstMessage(z.number().int(), 1.5)).toBe("Debe ser un número entero");
    expect(firstMessage(z.number().int().nonnegative(), -1)).toBe("Debe ser mínimo 0");
  });

  it("traduce textos, correos, fechas y obligatorios", () => {
    expect(firstMessage(z.string().email(), "no-es-correo")).toBe("Ingresa un correo válido");
    expect(firstMessage(z.string().min(8), "corta")).toBe("Escribe al menos 8 caracteres");
    expect(firstMessage(z.string().min(1), "")).toBe("Este campo es obligatorio");
    expect(firstMessage(z.string().date(), "08/11/2026")).toBe("Fecha inválida. Usa el formato AAAA-MM-DD");
    expect(firstMessage(z.object({ a: z.string() }), {})).toBe("Este campo es obligatorio");
    expect(firstMessage(z.string().max(3), "largo")).toBe("Máximo 3 caracteres");
  });

  it("respeta los mensajes propios que ya traen algunos contratos", () => {
    const schema = z.object({ a: z.string() }).refine(() => false, { message: "Nada que actualizar" });
    expect(firstMessage(schema, { a: "x" })).toBe("Nada que actualizar");
  });
});
