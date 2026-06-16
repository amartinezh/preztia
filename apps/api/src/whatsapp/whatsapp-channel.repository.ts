import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from '@preztiaos/domain';
import { schema } from '@preztiaos/db';
import type { WhatsappChannel } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { mapUniqueViolation } from '../shared/persistence-errors';

// Adaptador de `whatsapp_channel` (número → zona) bajo el rol `app` + RLS. El zone_path se
// denormaliza desde la zona elegida para estampar/scopear rápido.
@Injectable()
export class WhatsappChannelRepository {
  async list(tenantId: string): Promise<WhatsappChannel[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.whatsappChannel)
        .orderBy(desc(schema.whatsappChannel.createdAt));
      return rows.map((r) => ({
        id: r.id,
        phoneNumberId: r.phoneNumberId,
        zoneId: r.zoneId,
        zonePath: r.zonePath,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async create(input: {
    tenantId: string;
    phoneNumberId: string;
    zoneId: string;
  }): Promise<{ id: string }> {
    return mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          const [zone] = await tx
            .select({ path: schema.zone.path })
            .from(schema.zone)
            .where(eq(schema.zone.id, input.zoneId))
            .limit(1);
          if (!zone) throw new NotFoundError('La zona no existe');
          const [created] = await tx
            .insert(schema.whatsappChannel)
            .values({
              tenantId: input.tenantId,
              phoneNumberId: input.phoneNumberId,
              zoneId: input.zoneId,
              zonePath: zone.path,
            })
            .returning({ id: schema.whatsappChannel.id });
          return { id: created.id };
        }),
      'Ese número de WhatsApp ya está vinculado a una zona',
    );
  }

  async remove(input: { tenantId: string; id: string }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const deleted = await tx
        .delete(schema.whatsappChannel)
        .where(eq(schema.whatsappChannel.id, input.id))
        .returning({ id: schema.whatsappChannel.id });
      return deleted.length > 0;
    });
  }
}
