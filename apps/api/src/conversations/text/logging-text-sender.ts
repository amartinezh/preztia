import { Injectable } from '@nestjs/common';
import {
  type OutboundRecipient,
  type OutboundTextSender,
} from '@preztiaos/application';
import { WhatsappTextSender } from './whatsapp-text-sender';
import { ConversationMessageLog } from '../conversation-message.log';

/**
 * Decorador del puerto OutboundTextSender: envía el texto con el adaptador real y,
 * además, registra el mensaje SALIENTE en el transcript. Mantiene el SRP: el envío y el
 * registro son responsabilidades distintas; el registro es best-effort (lo gestiona el log).
 */
@Injectable()
export class LoggingTextSender implements OutboundTextSender {
  constructor(
    private readonly inner: WhatsappTextSender,
    private readonly log: ConversationMessageLog,
  ) {}

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    await this.inner.sendText(to, body);
    await this.log.recordOutbound(to, body);
  }
}
