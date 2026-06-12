// Conceptos de dominio para la atención por texto vía WhatsApp.
// El "cómo" (qué proveedor de IA, qué HTTP) vive en infraestructura; aquí solo
// los valores estables que el negocio entiende.

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
   * (en español, apta para WhatsApp). Para las otras clasificaciones el caso de
   * uso decide el texto (oferta de solicitud o aviso de fuera de alcance).
   */
  readonly reply: string;
}

/**
 * Respuesta cordial fija cuando el mensaje queda fuera del alcance del servicio.
 * Vive en el dominio (no la genera el modelo) para que el aviso sea determinista
 * y consistente, sin depender de la redacción del proveedor de IA.
 */
export const OFF_TOPIC_REPLY =
  "Con gusto te atiendo, pero este chat es exclusivamente para temas relacionados con nuestro servicio de apoyo crediticio (información del crédito y solicitudes). ¿Tienes alguna duda sobre el crédito o deseas iniciar una solicitud?";

/**
 * Respuesta de degradación elegante cuando el asistente de IA no está disponible
 * (p. ej. el proveedor agotó la cuota o no responde). Permite informar al usuario en
 * vez de fallar en silencio o dejar que el error escale a un reintento del webhook.
 */
export const ASSISTANT_UNAVAILABLE_REPLY =
  "En este momento tenemos alta demanda y no puedo procesar tu mensaje. Por favor, inténtalo de nuevo en unos minutos. 🙏";
