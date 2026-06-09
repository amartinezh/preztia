import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  TenantAssistantConfig,
  TenantAssistantConfigRepository,
} from '@preztiaos/application';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
} from '../../tenancy/unit-of-work';

/**
 * Adaptador: carga la configuración del asistente desde la BD.
 * Resuelve el tenant por el phone_number_id y luego lee tenant_config bajo RLS
 * con el tenant ya fijado (defensa en profundidad: el aislamiento lo aplica PG).
 */
@Injectable()
export class TenantConfigDrizzleRepository implements TenantAssistantConfigRepository {
  async findByChannelId(
    channelId: string,
  ): Promise<TenantAssistantConfig | null> {
    const tenantId = await resolveTenantByWhatsappPhone(channelId);
    if (!tenantId) return null;

    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId));
      if (!row) return null;

      return {
        tenantId: row.tenantId,
        knowledgeBase: row.knowledgeBase,
        aiProvider: row.aiProvider,
        aiApiKey: row.aiApiKey,
      };
    });
  }
}
