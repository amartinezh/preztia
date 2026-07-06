import { Injectable, Logger } from '@nestjs/common';
import {
  AnswerTextMessageHandler,
  OfferOrCreateChargeHandler,
  RecordAmountReplyHandler,
  RecordPlanReplyHandler,
  TextMessageConsumer,
} from '@preztiaos/application';
import { TextMessage } from '@preztiaos/domain';

/**
 * Adaptador del puerto TextMessageConsumer: muestra el texto entrante en consola (observabilidad)
 * y enruta por prioridad de etapa:
 *   1) negociación del plan (post-revisión, Fase 10);
 *   2) captura del monto solicitado (inicio de la solicitud);
 *   3) cobro conversacional (el cliente EXPRESA que quiere pagar o responde el menú de montos);
 *   4) asistente de conocimiento (IA) por defecto.
 * Cada interceptor devuelve `true` si atendió el mensaje (corta el flujo). Las etapas de
 * originación (1–2) son excluyentes con el cobro (3, requiere crédito activo), así que el orden es
 * seguro: un cliente en originación no llega al cobro; uno con crédito activo sí.
 */
@Injectable()
export class WhatsappTextConsumer implements TextMessageConsumer {
  private readonly logger = new Logger('WhatsApp:Text');

  constructor(
    private readonly answer: AnswerTextMessageHandler,
    private readonly planReply: RecordPlanReplyHandler,
    private readonly amountReply: RecordAmountReplyHandler,
    private readonly offerCharge: OfferOrCreateChargeHandler,
  ) {}

  async consume(message: TextMessage): Promise<void> {
    this.logger.log(`📝 [${message.from}] ${message.body}`);
    if (await this.planReply.handle(message)) return;
    if (await this.amountReply.handle(message)) return;
    if (await this.offerCharge.handle(message)) return;
    await this.answer.execute(message);
  }
}
