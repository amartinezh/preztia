import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  AssistantConfigStore,
  AssistantConfigView,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del asistente de WhatsApp: lee/escribe `tenant_config` (knowledge_base, ai_provider,
 * ai_api_key) bajo el rol `app` + RLS. La API key es un SECRETO: `getView` solo informa si existe
 * (`hasApiKey`), nunca la devuelve. Upsert por campo presente: no pisa columnas no enviadas.
 */
@Injectable()
export class AssistantConfigRepository implements AssistantConfigStore {
  async getView(tenantId: string): Promise<AssistantConfigView> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          knowledgeBase: schema.tenantConfig.knowledgeBase,
          aiProvider: schema.tenantConfig.aiProvider,
          aiApiKey: schema.tenantConfig.aiApiKey,
        })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId))
        .limit(1);
      return {
        knowledgeBase: row?.knowledgeBase ?? '',
        aiProvider: row?.aiProvider ?? 'GEMINI',
        hasApiKey: !!row?.aiApiKey && row.aiApiKey.trim() !== '',
      };
    });
  }

  async save(input: {
    tenantId: string;
    knowledgeBase?: string;
    aiProvider?: AssistantConfigView['aiProvider'];
    aiApiKey?: string;
  }): Promise<void> {
    const { tenantId, knowledgeBase, aiProvider, aiApiKey } = input;
    // Solo se tocan las columnas presentes en el parche. `aiApiKey` vacío borra la credencial.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (knowledgeBase !== undefined) set.knowledgeBase = knowledgeBase;
    if (aiProvider !== undefined) set.aiProvider = aiProvider;
    if (aiApiKey !== undefined) set.aiApiKey = aiApiKey === '' ? null : aiApiKey;

    await withTenantTxFor(tenantId, async (tx) => {
      await tx
        .insert(schema.tenantConfig)
        .values({
          tenantId,
          ...(knowledgeBase !== undefined ? { knowledgeBase } : {}),
          ...(aiProvider !== undefined ? { aiProvider } : {}),
          ...(aiApiKey !== undefined && aiApiKey !== '' ? { aiApiKey } : {}),
        })
        .onConflictDoUpdate({
          target: schema.tenantConfig.tenantId,
          set,
        });
    });
  }
}
