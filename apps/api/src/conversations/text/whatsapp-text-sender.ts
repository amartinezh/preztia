import { Injectable, Logger } from '@nestjs/common';
import { OutboundRecipient, OutboundTextSender } from '@preztiaos/application';
import { resolveWhatsappCredentialsByPhone } from '../../tenancy/unit-of-work';

const DEFAULT_GRAPH_VERSION = 'v21.0';

/** Adaptador: envía la respuesta de texto de vuelta por la Graph API de WhatsApp. */
@Injectable()
export class WhatsappTextSender implements OutboundTextSender {
  private readonly logger = new Logger('WhatsApp:Send');

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    // Credenciales por número (BD, cifradas): la única fuente es la pantalla "WhatsApp de la zona".
    const creds = await resolveWhatsappCredentialsByPhone(to.channelId);
    const token = creds?.accessToken;
    if (!token) {
      // Sin token del canal la respuesta no se puede enviar; queda trazada en consola.
      this.logger.warn(
        `Canal ${to.channelId} sin access token configurado; respuesta NO enviada a ${to.recipient}: ${body}`,
      );
      return;
    }

    const version = creds?.graphVersion ?? DEFAULT_GRAPH_VERSION;
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
