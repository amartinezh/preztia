import {
  type OutboundRecipient,
  type OutboundTextSender,
} from '@preztiaos/application';
import { ConversationMessageLog } from '../conversation-message.log';

/**
 * Decorador del puerto OutboundTextSender: envía el texto con el adaptador real y,
 * además, registra el mensaje SALIENTE en el transcript. Mantiene el SRP: el envío y el
 * registro son responsabilidades distintas; el registro es best-effort (lo gestiona el log).
 * Decora cualquier implementación del puerto (el router por proveedor en producción); por eso
 * se construye siempre por fábrica y no lo instancia el contenedor de Nest.
 */
export class LoggingTextSender implements OutboundTextSender {
  constructor(
    private readonly inner: OutboundTextSender,
    private readonly log: ConversationMessageLog,
  ) {}

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    await this.inner.sendText(to, body);
    await this.log.recordOutbound(to, body);
  }
}
