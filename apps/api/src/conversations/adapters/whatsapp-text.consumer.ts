import { Injectable, Logger } from '@nestjs/common';
import {
  AnswerAccountInquiryHandler,
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
 *   4) consulta de cuenta (el cliente pide su SALDO o el MOVIMIENTO de sus pagos);
 *   5) asistente de conocimiento (IA) por defecto.
 * Cada interceptor devuelve `true` si atendió el mensaje (corta el flujo). Las etapas de
 * originación (1–2) son excluyentes con las de un crédito activo (3–4): un cliente en originación no
 * llega a ellas; uno con crédito activo sí. El cobro (3) precede a la consulta (4) para que un
 * "quiero pagar" genere el cobro y no un informe de saldo.
 */
@Injectable()
export class WhatsappTextConsumer implements TextMessageConsumer {
  private readonly logger = new Logger('WhatsApp:Text');

  constructor(
    private readonly answer: AnswerTextMessageHandler,
    private readonly planReply: RecordPlanReplyHandler,
    private readonly amountReply: RecordAmountReplyHandler,
    private readonly offerCharge: OfferOrCreateChargeHandler,
    private readonly accountInquiry: AnswerAccountInquiryHandler,
  ) {}

  async consume(message: TextMessage): Promise<void> {
    this.logger.log(`📝 [${message.from}] ${message.body}`);
    if (await this.planReply.handle(message)) return;
    if (await this.amountReply.handle(message)) return;
    if (await this.offerCharge.handle(message)) return;
    if (await this.accountInquiry.handle(message)) return;
    await this.answer.execute(message);
  }
}
