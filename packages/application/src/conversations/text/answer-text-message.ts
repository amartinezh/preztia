import type { AssistantAnswer, TextMessage } from "@preztiaos/domain";
import { ASSISTANT_UNAVAILABLE_REPLY, OFF_TOPIC_REPLY } from "@preztiaos/domain";
// El deduplicador es un puerto genérico de idempotencia de webhooks (compartido con el
// slice de documentos); se reutiliza para no reprocesar el mismo wamid de texto.
import type { InboundMessageDeduplicator } from "../../credit/application/ports";
import type {
  CreditApplicationRestarter,
  CreditApplicationStarter,
  KnowledgeAssistant,
  OutboundTextSender,
  PendingDocumentReminder,
  TenantAssistantConfigRepository,
} from "./ports";

/**
 * Caso de uso de la Fase 1 (texto): clasifica el mensaje con IA en una de tres vías
 * y enruta la conversación:
 *   A. knowledge_question → responde con la base de conocimiento del tenant.
 *   B. credit_application → da apertura a la solicitud de documentos.
 *   C. off_topic        → indica cordialmente que el chat es solo para el servicio.
 * Además insiste: si el usuario ya tiene una solicitud con documentos pendientes,
 * recuerda el documento que falta hasta lograr la completitud.
 *
 * Es idempotente (no reprocesa el mismo wamid) y degrada con elegancia si el asistente
 * de IA no está disponible. No conoce HTTP, Gemini ni la BD: solo coordina dominio + puertos.
 */
export class AnswerTextMessageHandler {
  constructor(
    private readonly configs: TenantAssistantConfigRepository,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly assistant: KnowledgeAssistant,
    private readonly sender: OutboundTextSender,
    private readonly creditApplications: CreditApplicationStarter,
    private readonly creditRestarts: CreditApplicationRestarter,
    private readonly reminders: PendingDocumentReminder,
  ) {}

  async execute(message: TextMessage): Promise<void> {
    const config = await this.configs.findByChannelId(message.channelId);
    // Sin tenant, sin credencial o sin base de conocimiento no hay nada que responder.
    if (!config?.aiApiKey || config.knowledgeBase.trim() === "") return;

    // Idempotencia: un wamid ya procesado no se vuelve a atender (evita doble respuesta
    // y doble consumo de IA ante reentregas/duplicados del webhook).
    if (!(await this.dedup.firstSeen({ tenantId: config.tenantId, messageId: message.id }))) {
      return;
    }

    const applicant = {
      tenantId: config.tenantId,
      channelId: message.channelId,
      applicant: message.from,
    };
    const recipient = { channelId: message.channelId, recipient: message.from };

    let answer: AssistantAnswer;
    try {
      answer = await this.assistant.answer({
        knowledgeBase: config.knowledgeBase,
        question: message.body,
        provider: config.aiProvider,
        apiKey: config.aiApiKey,
      });
    } catch {
      // Degradación elegante: el proveedor de IA falló (p. ej. cuota agotada). Informamos
      // al usuario en vez de escalar el error y provocar reintentos del webhook.
      await this.sender.sendText(recipient, ASSISTANT_UNAVAILABLE_REPLY);
      return;
    }

    // B: el usuario quiere solicitar el crédito → inicia o retoma el protocolo,
    // que envía su propio mensaje (intro + primer documento, o recordatorio).
    if (answer.classification === "credit_application") {
      await this.creditApplications.start(applicant);
      return;
    }

    // D: el usuario quiere volver a enviar todos los documentos → reinicia la solicitud.
    if (answer.classification === "restart_application") {
      await this.creditRestarts.restart(applicant);
      return;
    }

    // A: pregunta de conocimiento → respuesta del modelo. C: fuera de alcance → aviso fijo.
    const base = answer.classification === "off_topic" ? OFF_TOPIC_REPLY : answer.reply;

    // Insistir: si hay una solicitud activa con documentos pendientes, recuérdalo.
    const reminder = await this.reminders.forApplicant(applicant);
    const body = reminder ? `${base}\n\n${reminder}` : base;

    await this.sender.sendText(recipient, body);
  }
}
