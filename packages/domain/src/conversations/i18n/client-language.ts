import { DomainError } from "../../shared/money";

// Idioma en el que la empresa (tenant) atiende a SUS CLIENTES por chat (WhatsApp/Telegram). Es una
// configuración por tenant, no por usuario: todos los mensajes al cliente —deterministas o de la IA—
// salen en este idioma. Agregar un idioma = sumarlo aquí y escribir su diccionario (el compilador
// exige que tenga TODAS las claves del catálogo; ver `client-messages.ts`).

export const CLIENT_LANGUAGES = ["es", "pt-BR"] as const;

export type ClientLanguage = (typeof CLIENT_LANGUAGES)[number];

/** Idioma de todos los tenants anteriores a los diccionarios: español. */
export const DEFAULT_CLIENT_LANGUAGE: ClientLanguage = "es";

export function isClientLanguage(value: unknown): value is ClientLanguage {
  return typeof value === "string" && (CLIENT_LANGUAGES as readonly string[]).includes(value);
}

/** Valida un idioma al CONFIGURARLO: falla rápido si no está soportado. */
export function parseClientLanguage(value: string): ClientLanguage {
  if (!isClientLanguage(value)) {
    throw new DomainError(`Idioma no soportado: ${value}`, "UNSUPPORTED_CLIENT_LANGUAGE");
  }
  return value;
}

/**
 * Lectura tolerante desde persistencia: un valor ausente o desconocido (p. ej. un idioma retirado)
 * cae al idioma por defecto para que el chat nunca quede sin responder.
 */
export function clientLanguageOrDefault(value: string | null | undefined): ClientLanguage {
  return isClientLanguage(value) ? value : DEFAULT_CLIENT_LANGUAGE;
}
