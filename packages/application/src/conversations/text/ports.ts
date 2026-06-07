import type { AiProvider, AssistantAnswer } from "@preztiaos/domain";

// Configuración del asistente de un tenant, tal como la necesita el caso de uso.
// La carga (resolución de tenant + lectura bajo RLS) es responsabilidad de la infraestructura.
export interface TenantAssistantConfig {
  readonly tenantId: string;
  /** Base de conocimiento: única fuente válida para responder. */
  readonly knowledgeBase: string;
  readonly aiProvider: AiProvider;
  /** Credencial del proveedor de IA; null si el tenant aún no la configuró. */
  readonly aiApiKey: string | null;
}

/** Puerto: resuelve la configuración del asistente a partir del canal (phone_number_id). */
export interface TenantAssistantConfigRepository {
  findByChannelId(channelId: string): Promise<TenantAssistantConfig | null>;
}

/** Petición al modelo: responder la pregunta ciñéndose a la base de conocimiento. */
export interface AssistantRequest {
  readonly knowledgeBase: string;
  readonly question: string;
  readonly provider: AiProvider;
  readonly apiKey: string;
}

/** Puerto: evalúa el texto con IA y devuelve la respuesta restringida a la base de conocimiento. */
export interface KnowledgeAssistant {
  answer(request: AssistantRequest): Promise<AssistantAnswer>;
}

/** Destinatario de un mensaje saliente de WhatsApp. */
export interface OutboundRecipient {
  /** phone_number_id del negocio que envía. */
  readonly channelId: string;
  /** teléfono del destinatario. */
  readonly recipient: string;
}

/** Puerto: envía una respuesta de texto de vuelta al usuario por WhatsApp. */
export interface OutboundTextSender {
  sendText(to: OutboundRecipient, body: string): Promise<void>;
}

/** Puerto: inicia el proceso de solicitud de crédito (documentación). Se desarrollará más adelante. */
export interface CreditApplicationStarter {
  start(input: { tenantId: string; channelId: string; applicant: string }): Promise<void>;
}
