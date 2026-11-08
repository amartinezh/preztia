import { z, type ZodErrorMap } from "zod";

/**
 * Mensajes de validación de zod en el idioma de la persona. Los esquemas del contrato
 * (`@preztiaos/contracts`) no traen mensajes propios en su mayoría, así que sin este mapa la UI
 * mostraría "Number must be greater than 0" o "Expected number, received nan". Se instala una vez
 * al arrancar la app; aplica a cualquier `safeParse` posterior (misma instancia de zod).
 */
export const spanishZodErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: "Este campo es obligatorio" };
      }
      if (issue.expected === "integer") return { message: "Debe ser un número entero" };
      if (issue.expected === "number") return { message: "Ingresa un número válido" };
      if (issue.expected === "string") return { message: "Ingresa un texto válido" };
      return { message: "Valor no válido" };
    case z.ZodIssueCode.too_small:
      if (issue.type === "number") {
        return {
          message:
            issue.minimum === 0 && !issue.inclusive
              ? "Debe ser mayor que 0"
              : `Debe ser ${issue.inclusive ? "mínimo" : "mayor que"} ${String(issue.minimum)}`,
        };
      }
      if (issue.type === "string") {
        return {
          message:
            Number(issue.minimum) <= 1
              ? "Este campo es obligatorio"
              : `Escribe al menos ${String(issue.minimum)} caracteres`,
        };
      }
      if (issue.type === "array") return { message: "Selecciona al menos un elemento" };
      return { message: "Valor demasiado pequeño" };
    case z.ZodIssueCode.too_big:
      if (issue.type === "number") {
        return { message: `Debe ser ${issue.inclusive ? "máximo" : "menor que"} ${String(issue.maximum)}` };
      }
      if (issue.type === "string") return { message: `Máximo ${String(issue.maximum)} caracteres` };
      return { message: "Valor demasiado grande" };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "Ingresa un correo válido" };
      if (issue.validation === "uuid") return { message: "Selecciona una opción de la lista" };
      if (issue.validation === "date") return { message: "Fecha inválida. Usa el formato AAAA-MM-DD" };
      if (issue.validation === "datetime") return { message: "Fecha y hora inválidas" };
      if (issue.validation === "url") return { message: "Ingresa una dirección web válida" };
      if (issue.validation === "regex") return { message: "El formato no es válido" };
      return { message: "El formato no es válido" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Selecciona una opción válida" };
    case z.ZodIssueCode.custom:
      return { message: issue.message ?? "Valor no válido" };
    default:
      return { message: ctx.defaultError };
  }
};

/** Instala el mapa global. Idempotente: llamarlo varias veces no tiene efecto adicional. */
export function installZodErrorMap(): void {
  z.setErrorMap(spanishZodErrorMap);
}
