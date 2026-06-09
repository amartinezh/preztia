import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type RequiredDocumentCatalog } from '@preztiaos/application';
import {
  type RequiredDocumentSpec,
  type RequiredDocumentType,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto RequiredDocumentCatalog: lee la tabla
 * `credit_document_requirement` del tenant (bajo RLS, tenant ya fijado por
 * transacción) y devuelve los documentos activos en su orden de solicitud.
 * No contiene reglas de negocio: solo traduce persistencia → dominio.
 */
@Injectable()
export class RequiredDocumentCatalogDrizzleRepository implements RequiredDocumentCatalog {
  async listRequested(
    tenantId: string,
  ): Promise<readonly RequiredDocumentSpec[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select({
          key: schema.creditDocumentRequirement.documentKey,
          title: schema.creditDocumentRequirement.title,
          description: schema.creditDocumentRequirement.description,
        })
        .from(schema.creditDocumentRequirement)
        .where(
          and(
            eq(schema.creditDocumentRequirement.tenantId, tenantId),
            eq(schema.creditDocumentRequirement.active, true),
          ),
        )
        .orderBy(asc(schema.creditDocumentRequirement.sortOrder));

      return rows.map(
        (row: {
          key: RequiredDocumentType;
          title: string;
          description: string;
        }): RequiredDocumentSpec => ({
          key: row.key,
          title: row.title,
          description: row.description,
        }),
      );
    });
  }
}
