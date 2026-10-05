// Conceptos de dominio para la atención por texto vía WhatsApp.
// El "cómo" (qué proveedor de IA, qué HTTP) vive en infraestructura; aquí solo
// los valores estables que el negocio entiende.

import { DEFAULT_CLIENT_LANGUAGE, type ClientLanguage } from "./i18n/client-language";
import { clientMessagesFor } from "./i18n/client-messages";

/** Proveedores de IA soportados. Debe coincidir con el enum `ai_provider` de la BD. */
export type AiProvider = "GEMINI" | "OPENAI" | "CLAUDE";

/**
 * Clasificación del mensaje de un usuario: las intenciones que el chat de apoyo
 * crediticio sabe atender. Determina cómo se enruta la conversación.
 */
export type MessageClassification =
  /** A: pregunta resoluble con la base de conocimiento del tenant. */
  | "knowledge_question"
  /** B: el usuario quiere iniciar la solicitud de crédito ahora. */
  | "credit_application"
  /** D: el usuario quiere reiniciar y volver a enviar todos los documentos. */
  | "restart_application"
  /** C: tema ajeno al servicio de apoyo crediticio. */
  | "off_topic";

/** Resultado de evaluar un mensaje contra la base de conocimiento del tenant. */
export interface AssistantAnswer {
  /** Clasificación del mensaje; define el enrutamiento de la conversación. */
  readonly classification: MessageClassification;
  /**
   * Respuesta a enviar al usuario cuando la clasificación es `knowledge_question`
   * (en el idioma del tenant, apta para el chat). Para las otras clasificaciones el caso de
   * uso decide el texto (oferta de solicitud o aviso de fuera de alcance).
   */
  readonly reply: string;
}

/**
 * Respuestas fijas del asistente (fuera de alcance, degradación y solicitante comprometido). Viven
 * en el dominio (no las genera el modelo) para que sean deterministas; su redacción por idioma está
 * en el catálogo de mensajes al cliente. Estas constantes son la versión en español (idioma por
 * defecto), conservadas para los importadores existentes.
 */
export const OFF_TOPIC_REPLY = clientMessagesFor("es").assistant.offTopic;

export const ASSISTANT_UNAVAILABLE_REPLY = clientMessagesFor("es").assistant.unavailable;

/**
 * Respuesta para un solicitante que YA aceptó su oferta o ya tiene el crédito otorgado: no se le
 * re-ofrece iniciar una solicitud; se confirma que su proceso está en curso y se le da el canal de
 * atención de la zona.
 */
export function buildCommittedApplicantReply(
  supportPhone: string | null,
  language: ClientLanguage = DEFAULT_CLIENT_LANGUAGE,
): string {
  return clientMessagesFor(language).assistant.committedApplicant(supportPhone);
}
