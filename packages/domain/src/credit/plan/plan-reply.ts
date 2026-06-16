// Interpretación pura (determinista, sin I/O) de la respuesta del cliente por WhatsApp durante la
// negociación del plan. El webhook delega aquí para mantener el parseo testeable sin WhatsApp.

// Marcas diacríticas combinadas (acentos) a eliminar tras NFD, por punto de código (sin literales).
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Quita acentos y normaliza a minúsculas para comparar de forma robusta. */
function normalize(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * Interpreta la selección de plan: el cliente responde con el número de la opción (1..n). Devuelve
 * el índice 1-based elegido, o `null` si no es un número válido dentro del rango ofrecido.
 */
export function parsePlanSelection(text: string, optionCount: number): number | null {
  const match = normalize(text).match(/\d+/);
  if (!match) return null;
  const choice = Number(match[0]);
  return Number.isInteger(choice) && choice >= 1 && choice <= optionCount ? choice : null;
}

export type AcceptanceDecision = "ACCEPT" | "DECLINE";

const ACCEPT_WORDS = ["si", "sii", "acepto", "ok", "okay", "dale", "confirmo", "claro", "listo"];
const DECLINE_WORDS = ["no", "rechazo", "rechazar", "cancelar", "cancela", "negativo"];

/**
 * Interpreta la aceptación: "sí/acepto/ok…" → ACCEPT; "no/rechazo…" → DECLINE; `null` si es
 * ambiguo (el webhook re-pregunta). Se evalúa primero el rechazo para que "no acepto" → DECLINE.
 */
export function parseAcceptance(text: string): AcceptanceDecision | null {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (words.some((w) => DECLINE_WORDS.includes(w))) return "DECLINE";
  if (words.some((w) => ACCEPT_WORDS.includes(w))) return "ACCEPT";
  return null;
}
