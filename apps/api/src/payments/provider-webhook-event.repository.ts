import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Bitácora de webhooks de proveedores de pago (`provider_webhook_event`): registra TODA
 * notificación auténtica para trazabilidad de los pagos. Idempotente por
 * (tenant, provider, event_id): la reentrega de un evento no duplica el registro. Append-only.
 */
@Injectable()
export class ProviderWebhookEventDrizzleRepository {
  /** Registra el evento si no existía; devuelve `true` si es la primera vez que se ve. */
  async recordOnce(input: {
    tenantId: string;
    bankAccountId: string;
    providerType: 'MERCADOPAGO' | 'PICPAY';
    eventId: string;
    eventType: string;
    status: string | null;
    payload: unknown;
  }): Promise<{ recorded: boolean }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.providerWebhookEvent)
        .values({
          tenantId: input.tenantId,
          bankAccountId: input.bankAccountId,
          providerType: input.providerType,
          eventId: input.eventId,
          eventType: input.eventType,
          status: input.status,
          payload: input.payload ?? null,
        })
        .onConflictDoNothing({
          target: [
            schema.providerWebhookEvent.tenantId,
            schema.providerWebhookEvent.providerType,
            schema.providerWebhookEvent.eventId,
          ],
        })
        .returning({ id: schema.providerWebhookEvent.id });
      return { recorded: inserted.length > 0 };
    });
  }
}
