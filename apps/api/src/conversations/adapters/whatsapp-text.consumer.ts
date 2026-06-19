import { Injectable, Logger } from '@nestjs/common';
import {
  AnswerTextMessageHandler,
  RecordAmountReplyHandler,
  RecordPlanReplyHandler,
  TextMessageConsumer,
} from '@preztiaos/application';
import { TextMessage } from '@preztiaos/domain';

/**
 * Adaptador del puerto TextMessageConsumer: muestra el texto entrante en consola (observabilidad)
 * y enruta por prioridad de etapa del flujo de originación:
 *   1) negociación del plan (post-revisión, Fase 10);
 *   2) captura del monto solicitado (inicio de la solicitud);
 *   3) asistente de conocimiento (IA) por defecto.
 * Cada interceptor devuelve `true` si atendió el mensaje (corta el flujo). Las etapas son
 * mutuamente excluyentes por el ciclo de vida de la solicitud, así que el orden es seguro.
 */
@Injectable()
export class WhatsappTextConsumer implements TextMessageConsumer {
  private readonly logger = new Logger('WhatsApp:Text');

  constructor(
    private readonly answer: AnswerTextMessageHandler,
    private readonly planReply: RecordPlanReplyHandler,
    private readonly amountReply: RecordAmountReplyHandler,
  ) {}

  async consume(message: TextMessage): Promise<void> {
    this.logger.log(`📝 [${message.from}] ${message.body}`);
    if (await this.planReply.handle(message)) return;
    if (await this.amountReply.handle(message)) return;
    await this.answer.execute(message);
  }
}
