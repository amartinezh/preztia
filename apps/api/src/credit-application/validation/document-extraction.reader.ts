import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type DocumentExtractionReader,
  type PersistedDocumentExtraction,
} from '@preztiaos/application';
import {
  type FileTechnicalMetadata,
  type RequiredDocumentType,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../../tenancy/unit-of-work';

/**
 * Adaptador del puerto DocumentExtractionReader: devuelve la extracción MÁS
 * RECIENTE de cada tipo de documento de la solicitud (la vigente tras los
 * reintentos del solicitante), leída bajo RLS.
 */
@Injectable()
export class DrizzleDocumentExtractionReader implements DocumentExtractionReader {
  findLatestByApplication(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<readonly PersistedDocumentExtraction[]> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select({
          documentType: schema.documentExtraction.documentType,
          applicantPhone: schema.documentExtraction.applicantPhone,
          fields: schema.documentExtraction.fields,
          fileMetadata: schema.documentExtraction.fileMetadata,
          createdAt: schema.documentExtraction.createdAt,
        })
        .from(schema.documentExtraction)
        .where(eq(schema.documentExtraction.applicationId, input.applicationId))
        .orderBy(desc(schema.documentExtraction.createdAt));

      // Primera aparición por tipo = la más reciente (orden descendente).
      const latest = new Map<
        RequiredDocumentType,
        PersistedDocumentExtraction
      >();
      for (const row of rows) {
        if (latest.has(row.documentType)) continue;
        latest.set(row.documentType, {
          documentType: row.documentType,
          applicantPhone: row.applicantPhone,
          fields: row.fields ?? {},
          fileMetadata: toFileMetadata(row.fileMetadata),
        });
      }
      return [...latest.values()];
    });
  }
}

// La metadata viaja como jsonb laxo; aquí se re-tipa al contrato del dominio.
function toFileMetadata(
  value: Record<string, unknown> | null,
): FileTechnicalMetadata | null {
  if (!value) return null;
  const field = (key: string): string | null =>
    typeof value[key] === 'string' ? value[key] : null;
  return {
    producer: field('producer'),
    creator: field('creator'),
    software: field('software'),
    createDate: field('createDate'),
    modifyDate: field('modifyDate'),
  };
}
