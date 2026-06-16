import { Injectable, Logger } from '@nestjs/common';
import {
  AnswerTextMessageHandler,
  RecordPlanReplyHandler,
  TextMessageConsumer,
} from '@preztiaos/application';
import { TextMessage } from '@preztiaos/domain';

/**
 * Adaptador del puerto TextMessageConsumer: muestra el texto entrante en consola (observabilidad)
 * y enruta. Si el solicitante tiene una oferta de plan activa (Fase 10), su respuesta la atiende
 * la negociación; en caso contrario, el caso de uso del asistente evalúa con IA y responde.
 */
@Injectable()
export class WhatsappTextConsumer implements TextMessageConsumer {
  private readonly logger = new Logger('WhatsApp:Text');

  constructor(
    private readonly answer: AnswerTextMessageHandler,
    private readonly planReply: RecordPlanReplyHandler,
  ) {}

  async consume(message: TextMessage): Promise<void> {
    this.logger.log(`📝 [${message.from}] ${message.body}`);
    // Prioridad a la negociación del plan: si la atendió, no se invoca al asistente.
    if (await this.planReply.handle(message)) return;
    await this.answer.execute(message);
  }
}
