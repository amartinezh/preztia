import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  type OperationalSettings,
} from '@preztiaos/domain';
import type {
  DefaultCreditLimitProvider,
  TenantSettingsStore,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador de la configuración del tenant: lee/escribe `tenant_config.operational_settings`
 * bajo el rol `app` + RLS. Implementa el puerto de ajustes (config) y el de cupo por defecto
 * (que usa el alta de clientes). Si no hay fila aún, devuelve los valores por defecto.
 */
@Injectable()
export class TenantConfigRepository
  implements TenantSettingsStore, DefaultCreditLimitProvider
{
  async get(tenantId: string): Promise<OperationalSettings> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ settings: schema.tenantConfig.operationalSettings })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId))
        .limit(1);
      return row?.settings ?? DEFAULT_OPERATIONAL_SETTINGS;
    });
  }

  async save(input: {
    tenantId: string;
    settings: OperationalSettings;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Upsert: la fila puede no existir todavía para el tenant.
      await tx
        .insert(schema.tenantConfig)
        .values({
          tenantId: input.tenantId,
          operationalSettings: input.settings,
        })
        .onConflictDoUpdate({
          target: schema.tenantConfig.tenantId,
          set: { operationalSettings: input.settings, updatedAt: new Date() },
        });
    });
  }

  async defaultCreditLimitMinor(tenantId: string): Promise<number> {
    const settings = await this.get(tenantId);
    return settings.defaultCreditLimitMinor;
  }
}
