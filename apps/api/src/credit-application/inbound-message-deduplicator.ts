import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import { type InboundMessageDeduplicator } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto InboundMessageDeduplicator: registra el wamid procesado por
 * tenant. La unicidad de (tenant_id, message_id) hace idempotente el procesamiento
 * ante reentregas del webhook (ON CONFLICT DO NOTHING → no se reprocesa).
 */
@Injectable()
export class ProcessedInboundMessageDeduplicator implements InboundMessageDeduplicator {
  async firstSeen(input: {
    tenantId: string;
    messageId: string;
  }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.processedInboundMessage)
        .values({ tenantId: input.tenantId, messageId: input.messageId })
        .onConflictDoNothing()
        .returning({ messageId: schema.processedInboundMessage.messageId });
      return inserted.length > 0;
    });
  }
}
