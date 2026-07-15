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

/** Puerto: inicia (o retoma) el proceso de solicitud de crédito (documentación). */
export interface CreditApplicationStarter {
  start(input: { tenantId: string; channelId: string; applicant: string }): Promise<void>;
}

/**
 * Puerto: reinicia la solicitud activa del solicitante (vuelve todos los documentos a
 * pendientes) y pide de nuevo el primero. Si no hay solicitud activa, inicia una nueva.
 */
export interface CreditApplicationRestarter {
  restart(input: { tenantId: string; channelId: string; applicant: string }): Promise<void>;
}

/**
 * Puerto: si el solicitante tiene una solicitud activa con documentos pendientes,
 * devuelve un recordatorio (título del documento que falta) para insistir en la
 * comunicación hasta lograr la completitud; null si no hay nada pendiente.
 */
export interface PendingDocumentReminder {
  forApplicant(input: {
    tenantId: string;
    channelId: string;
    applicant: string;
  }): Promise<string | null>;
}

/** Contexto de un solicitante que YA se comprometió (aceptó la oferta o tiene el crédito otorgado). */
export interface CommittedApplicantContext {
  /** Teléfono de atención de la zona del canal para ofrecerlo ante inconvenientes (null si no hay). */
  readonly supportPhone: string | null;
}

/**
 * Puerto: indica si el solicitante ya se comprometió con un crédito (aceptó la oferta o su expediente
 * quedó APROBADO). Sirve para que el asistente de conocimiento NO le re-ofrezca iniciar una solicitud
 * (sería ilógico ofrecerle "iniciar" a quien acaba de tomar un crédito). Devuelve `null` si el
 * solicitante aún es un prospecto (sigue el flujo normal del asistente).
 */
export interface ApplicantJourneyReader {
  committedContext(input: {
    tenantId: string;
    channelId: string;
    applicantPhone: string;
  }): Promise<CommittedApplicantContext | null>;
}
