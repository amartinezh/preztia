import { Injectable } from '@nestjs/common';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  DocumentRequirementItem,
  DocumentRequirementsStore,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador de escritura del catálogo de documentos (`credit_document_requirement`) bajo el rol
 * `app` + RLS. `replace` deja el catálogo EXACTAMENTE como la lista provista: hace upsert por
 * `document_key` y desactiva los documentos que ya no estén. La lectura del bot vive en otro
 * adaptador (RequiredDocumentCatalog) del módulo de crédito.
 */
@Injectable()
export class DocumentRequirementsRepository implements DocumentRequirementsStore {
  async list(tenantId: string): Promise<DocumentRequirementItem[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      return tx
        .select({
          documentKey: schema.creditDocumentRequirement.documentKey,
          title: schema.creditDocumentRequirement.title,
          description: schema.creditDocumentRequirement.description,
          sortOrder: schema.creditDocumentRequirement.sortOrder,
          active: schema.creditDocumentRequirement.active,
        })
        .from(schema.creditDocumentRequirement)
        .where(eq(schema.creditDocumentRequirement.tenantId, tenantId))
        .orderBy(asc(schema.creditDocumentRequirement.sortOrder));
    });
  }

  async replace(input: {
    tenantId: string;
    items: DocumentRequirementItem[];
  }): Promise<void> {
    const { tenantId, items } = input;
    await withTenantTxFor(tenantId, async (tx) => {
      for (const item of items) {
        await tx
          .insert(schema.creditDocumentRequirement)
          .values({
            tenantId,
            documentKey: item.documentKey,
            title: item.title,
            description: item.description,
            sortOrder: item.sortOrder,
            active: item.active,
          })
          .onConflictDoUpdate({
            target: [
              schema.creditDocumentRequirement.tenantId,
              schema.creditDocumentRequirement.documentKey,
            ],
            set: {
              title: item.title,
              description: item.description,
              sortOrder: item.sortOrder,
              active: item.active,
              updatedAt: new Date(),
            },
          });
      }

      // El catálogo es exactamente la lista provista: desactiva las llaves que ya no están.
      const keptKeys = items.map((i) => i.documentKey);
      await tx
        .update(schema.creditDocumentRequirement)
        .set({ active: false, updatedAt: new Date() })
        .where(
          keptKeys.length > 0
            ? and(
                eq(schema.creditDocumentRequirement.tenantId, tenantId),
                notInArray(schema.creditDocumentRequirement.documentKey, keptKeys),
              )
            : eq(schema.creditDocumentRequirement.tenantId, tenantId),
        );
    });
  }
}
