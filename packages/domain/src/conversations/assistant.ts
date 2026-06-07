// Conceptos de dominio para la atención por texto vía WhatsApp.
// El "cómo" (qué proveedor de IA, qué HTTP) vive en infraestructura; aquí solo
// los valores estables que el negocio entiende.

/** Proveedores de IA soportados. Debe coincidir con el enum `ai_provider` de la BD. */
export type AiProvider = "GEMINI" | "OPENAI" | "CLAUDE";

/** Intención del usuario respecto a solicitar un crédito, inferida del mensaje. */
export type CreditIntent = "none" | "interested" | "ready_to_apply";

/** Resultado de evaluar un mensaje contra la base de conocimiento del tenant. */
export interface AssistantAnswer {
  /** Respuesta a enviar al usuario (en español, apta para WhatsApp). */
  readonly reply: string;
  /** true si la pregunta pudo responderse con la base de conocimiento. */
  readonly inScope: boolean;
  /** Intención detectada sobre iniciar la solicitud de crédito. */
  readonly creditIntent: CreditIntent;
}
