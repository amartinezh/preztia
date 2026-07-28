import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type ActiveCreditApplication,
  type ApplicantRef,
  type CreditApplicationRepository,
  type DocumentOutcome,
  type LockedCreditApplication,
} from '@preztiaos/application';
import {
  type CreditApplication,
  type CreditApplicationStatus,
  documentOf,
  type DocumentStatus,
  REQUESTED_DOCUMENTS,
  type RequiredDocumentType,
} from '@preztiaos/domain';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';

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

  /**
   * Abre UNA transacción, bloquea la fila de la solicitud activa (`FOR UPDATE`) y ejecuta `fn`
   * con el agregado ya leído. Dos mensajes del mismo solicitante (las dos fotos de un álbum,
   * que WhatsApp entrega como webhooks independientes) quedan así en serie: el segundo espera
   * al commit del primero y por tanto lee el estado YA avanzado.
   *
   * `fn` hace I/O de red (IA, MinIO, WhatsApp) con el cerrojo tomado; es deliberado, porque la
   * decisión depende del estado leído. El bloqueo afecta solo a esa solicitud, nunca a otras.
   */
  async withActiveApplicationLocked<T>(
    applicant: ApplicantRef,
    fn: (locked: LockedCreditApplication | null) => Promise<T>,
  ): Promise<T> {
    return withTenantTxFor(applicant.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.applicantPhone, applicant.applicant),
            inArray(schema.creditApplication.status, ACTIVE_STATUSES),
          ),
        )
        .for('update');
      if (!row) return fn(null);

      const docs = await tx
        .select()
        .from(schema.creditApplicationDocument)
        .where(eq(schema.creditApplicationDocument.applicationId, row.id));

      const locked: LockedCreditApplication = {
        id: row.id,
        application: toAggregate(row.status, docs),
        saveDocumentOutcome: (outcome) =>
          this.writeDocumentOutcome(tx, outcome),
      };
      return fn(locked);
    });
  }

  async create(input: {
    applicant: ApplicantRef;
    application: CreditApplication;
  }): Promise<string> {
    const { applicant, application } = input;
    return withTenantTxFor(applicant.tenantId, async (tx) => {
      // Zona del canal (un número = una zona): estampa la solicitud para scopearla por alcance.
      const [channel] = await tx
        .select({ zonePath: schema.whatsappChannel.zonePath })
        .from(schema.whatsappChannel)
        .where(eq(schema.whatsappChannel.phoneNumberId, applicant.channelId))
        .limit(1);

      const [created] = await tx
        .insert(schema.creditApplication)
        .values({
          tenantId: applicant.tenantId,
          channelId: applicant.channelId,
          applicantPhone: applicant.applicant,
          zonePath: channel?.zonePath ?? null,
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
          expectedFiles: doc.expectedFiles,
          receivedFiles: doc.receivedFiles,
          mismatchAttempts: doc.mismatchAttempts,
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

  async reset(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Vuelve todos los documentos a PENDING, limpiando los datos KYC previos. Los intentos
      // fallidos también se reinician: el solicitante empieza el protocolo de cero.
      await tx
        .update(schema.creditApplicationDocument)
        .set({
          status: 'PENDING',
          receivedFiles: 0,
          mismatchAttempts: 0,
          mediaId: null,
          storageKey: null,
          mimeType: null,
          sha256: null,
          fraudScore: null,
          fraudReasons: null,
          manualReview: false,
          updatedAt: new Date(),
        })
        .where(
          eq(
            schema.creditApplicationDocument.applicationId,
            input.applicationId,
          ),
        );

      // Los archivos de la ronda anterior quedan superados: se retiran para liberar los cupos
      // (1..expected_files) que la ronda nueva volverá a ocupar.
      await tx
        .delete(schema.creditApplicationDocumentFile)
        .where(
          eq(
            schema.creditApplicationDocumentFile.applicationId,
            input.applicationId,
          ),
        );

      await tx
        .update(schema.creditApplication)
        .set({ status: 'AWAITING_DOCUMENTS', updatedAt: new Date() })
        .where(eq(schema.creditApplication.id, input.applicationId));

      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        type: 'APPLICATION_RESTARTED',
        payload: null,
      });
    });
  }

  /**
   * Escribe el resultado de un archivo DENTRO de la transacción que ya sostiene el cerrojo:
   * archiva el binario aceptado, refleja el estado del agregado y deja el evento de auditoría.
   * Abrir aquí una transacción nueva provocaría un interbloqueo contra el `FOR UPDATE` propio.
   */
  private async writeDocumentOutcome(
    tx: Tx,
    outcome: DocumentOutcome,
  ): Promise<void> {
    const document = documentOf(outcome.application, outcome.documentType);
    const isFirstFile = document.receivedFiles === 1;

    // Archivo aceptado: queda registrado en su cupo (append-only, evidencia KYC).
    if (outcome.storageKey) {
      await tx.insert(schema.creditApplicationDocumentFile).values({
        tenantId: outcome.tenantId,
        applicationId: outcome.applicationId,
        documentType: outcome.documentType,
        slot: document.receivedFiles,
        mediaId: outcome.mediaId,
        storageKey: outcome.storageKey,
        mimeType: outcome.mimeType,
        sha256: outcome.sha256,
      });
    }

    await tx
      .update(schema.creditApplicationDocument)
      .set({
        status: document.status,
        receivedFiles: document.receivedFiles,
        mismatchAttempts: document.mismatchAttempts,
        fraudScore: outcome.assessment.score,
        fraudReasons: [...outcome.assessment.reasons],
        manualReview: outcome.manualReview,
        updatedAt: new Date(),
        // Las columnas de un solo archivo describen el PRIMERO: los lectores que muestran
        // "el documento" siguen viendo el anverso aunque después llegue el reverso.
        ...(isFirstFile && outcome.storageKey
          ? {
              mediaId: outcome.mediaId,
              storageKey: outcome.storageKey,
              mimeType: outcome.mimeType,
              sha256: outcome.sha256,
            }
          : {}),
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
        documentStatus: document.status,
        receivedFiles: document.receivedFiles,
        expectedFiles: document.expectedFiles,
        mismatchAttempts: document.mismatchAttempts,
        fraudStatus: outcome.assessment.status,
        fraudScore: outcome.assessment.score,
        manualReview: outcome.manualReview,
        applicationStatus: outcome.application.status,
      },
    });
  }
}

type DocumentRow = {
  documentType: RequiredDocumentType;
  status: DocumentStatus;
  expectedFiles: number;
  receivedFiles: number;
  mismatchAttempts: number;
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
    documents: ordered.map((d) => ({
      type: d.documentType,
      status: d.status,
      expectedFiles: d.expectedFiles,
      receivedFiles: d.receivedFiles,
      mismatchAttempts: d.mismatchAttempts,
    })),
  };
}

function orderIndex(type: RequiredDocumentType): number {
  // REQUESTED_DOCUMENTS es una tupla de literales; se ensancha para buscar el tipo general.
  const idx = (REQUESTED_DOCUMENTS as readonly RequiredDocumentType[]).indexOf(
    type,
  );
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}
