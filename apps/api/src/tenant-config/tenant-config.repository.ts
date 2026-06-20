import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  type OperationalSettings,
} from '@preztiaos/domain';
import type { UpdateCollectionReminderSettingsInput } from '@preztiaos/contracts';
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
      // Mezcla sobre los defaults: rellena claves nuevas (p. ej. los toggles de planes de la
      // Fase 10) en filas guardadas antes de su introducción, sin tocar lo ya configurado.
      return row?.settings
        ? { ...DEFAULT_OPERATIONAL_SETTINGS, ...row.settings }
        : DEFAULT_OPERATIONAL_SETTINGS;
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

  /** Configuración del cron de cobranza; mezcla sobre los defaults (filas anteriores a la feature). */
  async getReminderSettings(
    tenantId: string,
  ): Promise<schema.CollectionReminderSettings> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ settings: schema.tenantConfig.collectionReminderSettings })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId))
        .limit(1);
      return row?.settings
        ? { ...schema.DEFAULT_COLLECTION_REMINDER_SETTINGS, ...row.settings }
        : schema.DEFAULT_COLLECTION_REMINDER_SETTINGS;
    });
  }

  /** Aplica un patch parcial sobre la configuración actual de cobranza y devuelve el resultado. */
  async updateReminderSettings(input: {
    tenantId: string;
    patch: UpdateCollectionReminderSettingsInput;
  }): Promise<schema.CollectionReminderSettings> {
    const current = await this.getReminderSettings(input.tenantId);
    const next: schema.CollectionReminderSettings = {
      ...current,
      ...input.patch,
    };
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .insert(schema.tenantConfig)
        .values({ tenantId: input.tenantId, collectionReminderSettings: next })
        .onConflictDoUpdate({
          target: schema.tenantConfig.tenantId,
          set: { collectionReminderSettings: next, updatedAt: new Date() },
        });
    });
    return next;
  }
}
