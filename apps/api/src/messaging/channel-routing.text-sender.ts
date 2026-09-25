import { Injectable } from '@nestjs/common';
import type {
  OutboundRecipient,
  OutboundTextSender,
} from '@preztiaos/application';
import { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import { driverFor, type ChannelDrivers } from './channel-driver';

/**
 * Implementación del puerto `OutboundTextSender` que despacha al driver del proveedor del canal
 * (WhatsApp o Telegram, ADR #40). Los casos de uso siguen enviando a `{ channelId, recipient }` sin
 * saber por qué proveedor sale el mensaje.
 */
@Injectable()
export class ChannelRoutingTextSender implements OutboundTextSender {
  private readonly drivers: ChannelDrivers<OutboundTextSender>;

  constructor(whatsapp: WhatsappTextSender) {
    this.drivers = { WHATSAPP: whatsapp };
  }

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    return driverFor(this.drivers, to.channelId).sendText(to, body);
  }
}
