import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type ActiveCreditApplication,
  type ApplicantRef,
  type CreditApplicationRepository,
  type DocumentOutcome,
} from '@preztiaos/application';
import {
  type CreditApplication,
  type CreditApplicationStatus,
  type DocumentStatus,
  REQUESTED_DOCUMENTS,
  type RequiredDocumentType,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Estados en los que una solicitud se considera ACTIVA (en curso).
const ACTIVE_STATUSES: CreditApplicationStatus[] = [
  'AWAITING_DOCUMENTS',
  'IN_REVIEW',
];

/**
 * Adaptador del puerto CreditApplicationRepository: traduce el agregado de dominio
 * ↔ persistencia (Drizzle), siempre bajo RLS con el tenant ya fijado por transacción.
 * No contiene reglas de negocio: esas viven en el dominio.
 */
@Injectable()
export class CreditApplicationDrizzleRepository implements CreditApplicationRepository {
  async findActiveByApplicant(
    applicant: ApplicantRef,
  ): Promise<ActiveCreditApplication | null> {
    return withTenantTxFor(applicant.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.applicantPhone, applicant.applicant),
            inArray(schema.creditApplication.status, ACTIVE_STATUSES),
          ),
        );
      if (!row) return null;

      const docs = await tx
        .select()
        .from(schema.creditApplicationDocument)
        .where(eq(schema.creditApplicationDocument.applicationId, row.id));

      return { id: row.id, application: toAggregate(row.status, docs) };
    });
  }

  async create(input: {
    applicant: ApplicantRef;
    application: CreditApplication;
  }): Promise<string> {
    const { applicant, application } = input;
    return withTenantTxFor(applicant.tenantId, async (tx) => {
      const [created] = await tx
        .insert(schema.creditApplication)
        .values({
          tenantId: applicant.tenantId,
          channelId: applicant.channelId,
          applicantPhone: applicant.applicant,
          status: application.status,
        })
        .returning({ id: schema.creditApplication.id });

      const applicationId = created.id;

      await tx.insert(schema.creditApplicationDocument).values(
        application.documents.map((doc) => ({
          tenantId: applicant.tenantId,
          applicationId,
          documentType: doc.type,
          status: doc.status,
        })),
      );

      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: applicant.tenantId,
        applicationId,
        type: 'APPLICATION_CREATED',
        payload: { documents: application.documents.map((d) => d.type) },
      });

      return applicationId;
    });
  }

  async saveDocumentOutcome(outcome: DocumentOutcome): Promise<void> {
    const resultingStatus = documentStatusOf(
      outcome.application,
      outcome.documentType,
    );
    await withTenantTxFor(outcome.tenantId, async (tx) => {
      await tx
        .update(schema.creditApplicationDocument)
        .set({
          status: resultingStatus,
          mediaId: outcome.mediaId,
          storageKey: outcome.storageKey,
          mimeType: outcome.mimeType,
          sha256: outcome.sha256,
          fraudScore: outcome.assessment.score,
          fraudReasons: [...outcome.assessment.reasons],
          manualReview: outcome.manualReview,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              schema.creditApplicationDocument.applicationId,
              outcome.applicationId,
            ),
            eq(
              schema.creditApplicationDocument.documentType,
              outcome.documentType,
            ),
          ),
        );

      await tx
        .update(schema.creditApplication)
        .set({ status: outcome.application.status, updatedAt: new Date() })
        .where(eq(schema.creditApplication.id, outcome.applicationId));

      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: outcome.tenantId,
        applicationId: outcome.applicationId,
        type: 'DOCUMENT_RECORDED',
        payload: {
          documentType: outcome.documentType,
          documentStatus: resultingStatus,
          fraudStatus: outcome.assessment.status,
          fraudScore: outcome.assessment.score,
          manualReview: outcome.manualReview,
          applicationStatus: outcome.application.status,
        },
      });
    });
  }
}

type DocumentRow = {
  documentType: RequiredDocumentType;
  status: DocumentStatus;
};

// Reconstruye el agregado, ordenando los documentos según REQUESTED_DOCUMENTS para
// que `nextPendingDocument` respete el orden del protocolo.
function toAggregate(
  status: CreditApplicationStatus,
  docs: DocumentRow[],
): CreditApplication {
  const ordered = [...docs].sort(
    (a, b) => orderIndex(a.documentType) - orderIndex(b.documentType),
  );
  return {
    status,
    documents: ordered.map((d) => ({ type: d.documentType, status: d.status })),
  };
}

function orderIndex(type: RequiredDocumentType): number {
  // REQUESTED_DOCUMENTS es una tupla de literales; se ensancha para buscar el tipo general.
  const idx = (REQUESTED_DOCUMENTS as readonly RequiredDocumentType[]).indexOf(
    type,
  );
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function documentStatusOf(
  app: CreditApplication,
  type: RequiredDocumentType,
): DocumentStatus {
  const doc = app.documents.find((d) => d.type === type);
  if (!doc) throw new Error(`Documento ${type} ausente en el agregado`);
  return doc.status;
}
