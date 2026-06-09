import { Injectable, Logger } from '@nestjs/common';
import { OutboundRecipient, OutboundTextSender } from '@preztiaos/application';

const DEFAULT_GRAPH_VERSION = 'v21.0';

/** Adaptador: envía la respuesta de texto de vuelta por la Graph API de WhatsApp. */
@Injectable()
export class WhatsappTextSender implements OutboundTextSender {
  private readonly logger = new Logger('WhatsApp:Send');

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) {
      // En desarrollo, sin token, dejamos ver la respuesta en consola sin enviarla.
      this.logger.warn(
        `WHATSAPP_ACCESS_TOKEN no configurado; respuesta NO enviada a ${to.recipient}: ${body}`,
      );
      return;
    }

    const version = process.env.WHATSAPP_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION;
    const url = `https://graph.facebook.com/${version}/${to.channelId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.recipient,
        type: 'text',
        text: { body },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `WhatsApp Send API respondió ${res.status}: ${await res.text()}`,
      );
    }
  }
}
