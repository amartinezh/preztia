import { Injectable, Logger } from '@nestjs/common';
import {
  AnswerTextMessageHandler,
  TextMessageConsumer,
} from '@preztiaos/application';
import { TextMessage } from '@preztiaos/domain';

/**
 * Adaptador del puerto TextMessageConsumer: muestra el texto entrante en consola
 * (observabilidad) y delega la atención al caso de uso, que evalúa con IA y responde.
 */
@Injectable()
export class WhatsappTextConsumer implements TextMessageConsumer {
  private readonly logger = new Logger('WhatsApp:Text');

  constructor(private readonly answer: AnswerTextMessageHandler) {}

  async consume(message: TextMessage): Promise<void> {
    this.logger.log(`📝 [${message.from}] ${message.body}`);
    await this.answer.execute(message);
  }
}
