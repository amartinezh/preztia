import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CreditRegisteredNotifier } from '@preztiaos/application';
import { clientMessagesFor } from '@preztiaos/domain';
import { ClientLanguageRepository } from '../../tenant-config/client-language.repository';
import { withTenantTxFor } from '../../tenancy/unit-of-work';
import { ProactiveTextSender } from '../../messaging/proactive-text-sender';

/**
 * Adaptador del puerto `CreditRegisteredNotifier`: cuando el coordinador aprueba el expediente y se
 * genera el crédito, avisa al cliente por su canal (WhatsApp o Telegram) que quedó REGISTRADO y se desembolsará en breve,
 * ofreciéndole el teléfono de atención de la zona ante inconvenientes. La presentación (texto +
 * resolución del teléfono de la zona) es responsabilidad de infraestructura.
 *
 * Es best-effort: el crédito YA está creado y desembolsado cuando se llama, así que un fallo de
 * envío se registra pero NO se propaga (no revierte el crédito ni hace fallar la aprobación HTTP).
 */
@Injectable()
export class CreditRegisteredMessagingNotifier implements CreditRegisteredNotifier {
  private readonly logger = new Logger('Messaging:CreditRegistered');
  // Envío proactivo: el aviso sale por el canal ALCANZABLE hoy (WhatsApp o Telegram), partiendo del
  // guardado en la solicitud (ADR #40, D8).
  constructor(
    private readonly sender: ProactiveTextSender,
    private readonly languages: ClientLanguageRepository,
  ) {}

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
      const language = await this.languages.byTenant(input.tenantId);
      await this.sender.sendText(
        { channelId: input.channelId, recipient: input.recipient },
        clientMessagesFor(language).credit.registered(supportPhone),
      );
    } catch (error) {
      // Cortesía posterior al desembolso: no debe tumbar la aprobación si el envío falla.
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
