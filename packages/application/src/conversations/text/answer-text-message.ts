import type { TextMessage } from "@preztiaos/domain";
import type {
  CreditApplicationStarter,
  KnowledgeAssistant,
  OutboundTextSender,
  TenantAssistantConfigRepository,
} from "./ports";

/**
 * Caso de uso de la Fase 1 (texto): evalúa el mensaje con IA contra la base de
 * conocimiento del tenant, responde por WhatsApp y, si el usuario quiere iniciar
 * la solicitud de crédito, dispara el proceso de documentación.
 *
 * No conoce HTTP, Gemini ni la BD: solo coordina dominio + puertos.
 */
export class AnswerTextMessageHandler {
  constructor(
    private readonly configs: TenantAssistantConfigRepository,
    private readonly assistant: KnowledgeAssistant,
    private readonly sender: OutboundTextSender,
    private readonly creditApplications: CreditApplicationStarter,
  ) {}

  async execute(message: TextMessage): Promise<void> {
    const config = await this.configs.findByChannelId(message.channelId);
    // Sin tenant, sin credencial o sin base de conocimiento no hay nada que responder.
    if (!config?.aiApiKey || config.knowledgeBase.trim() === "") return;

    const answer = await this.assistant.answer({
      knowledgeBase: config.knowledgeBase,
      question: message.body,
      provider: config.aiProvider,
      apiKey: config.aiApiKey,
    });

    await this.sender.sendText(
      { channelId: message.channelId, recipient: message.from },
      answer.reply,
    );

    if (answer.creditIntent === "ready_to_apply") {
      await this.creditApplications.start({
        tenantId: config.tenantId,
        channelId: message.channelId,
        applicant: message.from,
      });
    }
  }
}
