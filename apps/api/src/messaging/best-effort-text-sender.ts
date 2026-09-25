import { Logger } from '@nestjs/common';
import type {
  OutboundRecipient,
  OutboundTextSender,
} from '@preztiaos/application';

/**
 * Decorador del puerto `OutboundTextSender` para los avisos que se envían DESPUÉS de un hecho ya
 * consumado (p. ej. "tu pago fue confirmado" tras abonar la cartera). El aviso es una cortesía:
 * su fallo (canal caído, cliente que bloqueó el bot) se REGISTRA pero no se propaga, para no
 * abortar el lote de conciliación ni aparentar que el pago falló. No es un catch vacío: cada
 * fallo queda en el log con el canal (sin PII).
 */
export class BestEffortTextSender implements OutboundTextSender {
  private readonly logger = new Logger('Messaging:Notice');

  constructor(private readonly inner: OutboundTextSender) {}

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    try {
      await this.inner.sendText(to, body);
    } catch (error) {
      this.logger.warn(
        `Aviso no entregado (canal de origen ${to.channelId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
