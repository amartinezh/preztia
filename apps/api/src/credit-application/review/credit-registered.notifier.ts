import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CreditRegisteredNotifier } from '@preztiaos/application';
import { withTenantTxFor } from '../../tenancy/unit-of-work';
import { WhatsappTextSender } from '../../conversations/text/whatsapp-text-sender';

/**
 * Adaptador del puerto `CreditRegisteredNotifier`: cuando el coordinador aprueba el expediente y se
 * genera el crédito, avisa al cliente por WhatsApp que quedó REGISTRADO y se desembolsará en breve,
 * ofreciéndole el teléfono de atención de la zona ante inconvenientes. La presentación (texto +
 * resolución del teléfono de la zona) es responsabilidad de infraestructura.
 *
 * Es best-effort: el crédito YA está creado y desembolsado cuando se llama, así que un fallo de
 * envío se registra pero NO se propaga (no revierte el crédito ni hace fallar la aprobación HTTP).
 */
@Injectable()
export class CreditRegisteredWhatsappNotifier implements CreditRegisteredNotifier {
  private readonly logger = new Logger('WhatsApp:CreditRegistered');
  // El sender es stateless (solo usa credenciales por número + fetch); se compone aquí para reusarlo.
  private readonly sender = new WhatsappTextSender();

  async notifyRegistered(input: {
    tenantId: string;
    zoneId: string;
    channelId: string;
    recipient: string;
  }): Promise<void> {
    try {
      const supportPhone = await this.resolveSupportPhone(
        input.tenantId,
        input.zoneId,
      );
      await this.sender.sendText(
        { channelId: input.channelId, recipient: input.recipient },
        buildMessage(supportPhone),
      );
    } catch (error) {
      // Cortesía posterior al desembolso: no debe tumbar la aprobación si WhatsApp falla.
      this.logger.warn(
        `No se pudo avisar al cliente ${input.recipient} del crédito registrado: ${String(error)}`,
      );
    }
  }

  /** Teléfono de atención de la zona (null si la zona no existe o no lo configuró). */
  private async resolveSupportPhone(
    tenantId: string,
    zoneId: string,
  ): Promise<string | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ supportPhone: schema.zone.supportPhone })
        .from(schema.zone)
        .where(eq(schema.zone.id, zoneId))
        .limit(1);
      return row?.supportPhone ?? null;
    });
  }
}

/** Mensaje de crédito registrado; incluye el teléfono de atención de la zona si está configurado. */
function buildMessage(supportPhone: string | null): string {
  const support = supportPhone
    ? `Si tienes algún inconveniente, no dudes en escribirnos o comunicarte con servicio al cliente al ${supportPhone}.`
    : 'Si tienes algún inconveniente, no dudes en escribirnos o comunicarte con servicio al cliente.';
  return [
    '¡Tu crédito fue registrado! ✅ Lo desembolsaremos a la brevedad.',
    support,
  ].join('\n');
}
