import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  clientLanguageOrDefault,
  DEFAULT_CLIENT_LANGUAGE,
  type ClientLanguage,
} from '@preztiaos/domain';
import type {
  ClientLanguageResolver,
  ClientLanguageStore,
} from '@preztiaos/application';
import {
  resolveTenantByChannel,
  withTenantTxFor,
} from '../tenancy/unit-of-work';

/**
 * Adaptador de `tenant_config.client_language` bajo el rol `app` + RLS. A propósito NO cachea: cada
 * mensaje saliente lee el idioma vigente, así que un cambio en Ajustes aplica desde el siguiente
 * mensaje (es una lectura de una fila por PK). Sin fila o con un valor desconocido, español.
 */
@Injectable()
export class ClientLanguageRepository
  implements ClientLanguageStore, ClientLanguageResolver
{
  get(tenantId: string): Promise<ClientLanguage> {
    return this.byTenant(tenantId);
  }

  async byTenant(tenantId: string): Promise<ClientLanguage> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ language: schema.tenantConfig.clientLanguage })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId))
        .limit(1);
      return clientLanguageOrDefault(row?.language);
    });
  }

  async byChannel(channelId: string): Promise<ClientLanguage> {
    const tenantId = await resolveTenantByChannel(channelId);
    return tenantId ? this.byTenant(tenantId) : DEFAULT_CLIENT_LANGUAGE;
  }

  async save(input: {
    tenantId: string;
    language: ClientLanguage;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Upsert: la fila puede no existir todavía para el tenant.
      await tx
        .insert(schema.tenantConfig)
        .values({ tenantId: input.tenantId, clientLanguage: input.language })
        .onConflictDoUpdate({
          target: schema.tenantConfig.tenantId,
          set: { clientLanguage: input.language, updatedAt: new Date() },
        });
    });
  }
}
