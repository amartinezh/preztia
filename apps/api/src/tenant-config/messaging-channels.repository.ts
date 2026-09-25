import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  DEFAULT_MESSAGING_CHANNELS,
  type MessagingChannelsSettings,
} from '@preztiaos/domain';
import type {
  MessagingChannelsReader,
  MessagingChannelsStore,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador de `tenant_config.messaging_channels` (proveedores de mensajería habilitados, ADR #40)
 * bajo el rol `app` + RLS. Sin fila, o con una fila anterior a la columna, devuelve los defaults
 * (solo WhatsApp): el comportamiento de todos los tenants previos a Telegram.
 */
@Injectable()
export class MessagingChannelsRepository
  implements MessagingChannelsStore, MessagingChannelsReader
{
  async get(tenantId: string): Promise<MessagingChannelsSettings> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ settings: schema.tenantConfig.messagingChannels })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId))
        .limit(1);
      return row?.settings
        ? { ...DEFAULT_MESSAGING_CHANNELS, ...row.settings }
        : DEFAULT_MESSAGING_CHANNELS;
    });
  }

  async save(input: {
    tenantId: string;
    settings: MessagingChannelsSettings;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Upsert: la fila puede no existir todavía para el tenant.
      await tx
        .insert(schema.tenantConfig)
        .values({
          tenantId: input.tenantId,
          messagingChannels: input.settings,
        })
        .onConflictDoUpdate({
          target: schema.tenantConfig.tenantId,
          set: { messagingChannels: input.settings, updatedAt: new Date() },
        });
    });
  }
}
