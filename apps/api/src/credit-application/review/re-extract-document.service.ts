import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type DocumentReviewJob,
  ValidateApplicationDocumentsHandler,
} from '@preztiaos/application';
import { findDocumentSpec, type RequiredDocumentType } from '@preztiaos/domain';
import type { ReExtractDocumentOutput } from '@preztiaos/contracts';
import { withTenantTxFor } from '../../tenancy/unit-of-work';
import { AiDocumentReviewer } from '../document-reviewer';
import { GeminiBusinessPhotoAnalyzer } from '../ai/gemini-business-photo.analyzer';
import { RequiredDocumentCatalogDrizzleRepository } from '../required-document-catalog.repository';
import { DocumentOriginalStorage } from './document-original.storage';

/**
 * Caso de uso de infraestructura: NUEVA PASADA DE IA pedida por el revisor sobre un documento ya
 * subido del expediente. A veces la IA no identifica bien (p. ej. el documento de identidad sobre
 * un fondo rojo): este servicio recupera el original almacenado, vuelve a extraer con IA (persiste
 * la nueva extracción, que pasa a ser la más reciente del detalle) y re-dispara la validación
 * antifraude (best-effort) para refrescar el reporte. No altera la máquina de estados del documento
 * ni auto-rechaza: solo "intentar leer otra vez".
 */
@Injectable()
export class ReExtractDocumentService {
  private readonly logger = new Logger('CreditApplication:ReExtract');

  constructor(
    private readonly originals: DocumentOriginalStorage,
    private readonly reviewer: AiDocumentReviewer,
    private readonly catalog: RequiredDocumentCatalogDrizzleRepository,
    private readonly validate: ValidateApplicationDocumentsHandler,
    private readonly businessPhotoVision: GeminiBusinessPhotoAnalyzer,
  ) {}

  async execute(input: {
    tenantId: string;
    applicationId: string;
    documentType: RequiredDocumentType;
  }): Promise<ReExtractDocumentOutput> {
    const context = await this.loadContext(input);
    const original = await this.originals.fetch(input);

    // La foto del local NO se "lee" con OCR: se RE-ESTUDIA con visión antifraude (contraste con el
    // registro comercial). Persiste un nuevo veredicto que pasa a ser el más reciente del detalle.
    if (input.documentType === 'BUSINESS_PHOTO') {
      const verdict = await this.businessPhotoVision.analyze({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        applicantPhone: context.applicantPhone,
        mediaId: context.mediaId ?? '',
        photo: {
          bytes: original.bytes,
          mimeType: original.mimeType,
          sizeBytes: original.bytes.length,
          sha256: createHash('sha256').update(original.bytes).digest('hex'),
        },
      });
      if (!verdict) {
        return {
          extracted: false,
          identifiedType: null,
          matchesExpected: null,
          confidence: null,
          reason:
            'La IA no pudo analizar la foto del local (sin credencial de IA o el modelo falló). Inténtalo de nuevo.',
        };
      }
      return {
        extracted: true,
        identifiedType: 'business_photo',
        matchesExpected: verdict.matchesRegistry,
        confidence: verdict.veracityScore,
        reason: null,
      };
    }

    const specs = await this.catalog.listRequested(input.tenantId);
    const spec = findDocumentSpec(specs, input.documentType);

    const bytes = original.bytes;
    const job: DocumentReviewJob = {
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      documentType: input.documentType,
      applicantPhone: context.applicantPhone,
      mediaId: context.mediaId ?? '',
      ...(spec ? { spec } : {}),
      media: {
        bytes,
        mimeType: original.mimeType,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };

    const extraction = await this.reviewer.reExtract(job);
    // Refresca el reporte antifraude con la nueva extracción. Best-effort: si una verificación
    // externa (CNPJ/CEP/CPF) falla, la re-extracción ya quedó persistida y no se pierde.
    try {
      await this.validate.execute({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
    } catch (err) {
      this.logger.warn(
        `Re-validación tras re-extracción falló (app ${input.applicationId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!extraction) {
      return {
        extracted: false,
        identifiedType: null,
        matchesExpected: null,
        confidence: null,
        reason:
          'La IA no pudo leer el documento (sin credencial de IA configurada o el modelo falló). Inténtalo de nuevo.',
      };
    }
    return {
      extracted: true,
      identifiedType: extraction.identifiedType,
      matchesExpected: extraction.matchesExpected,
      confidence: extraction.confidence,
      reason: null,
    };
  }

  // Lee, bajo RLS, el teléfono del solicitante (para la extracción) y el media del documento.
  private async loadContext(input: {
    tenantId: string;
    applicationId: string;
    documentType: RequiredDocumentType;
  }): Promise<{ applicantPhone: string; mediaId: string | null }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [application] = await tx
        .select({ applicantPhone: schema.creditApplication.applicantPhone })
        .from(schema.creditApplication)
        .where(eq(schema.creditApplication.id, input.applicationId))
        .limit(1);
      if (!application) {
        throw new NotFoundException('Expediente no encontrado');
      }

      const [document] = await tx
        .select({ mediaId: schema.creditApplicationDocument.mediaId })
        .from(schema.creditApplicationDocument)
        .where(
          and(
            eq(
              schema.creditApplicationDocument.applicationId,
              input.applicationId,
            ),
            eq(
              schema.creditApplicationDocument.documentType,
              input.documentType,
            ),
          ),
        )
        .limit(1);

      return {
        applicantPhone: application.applicantPhone,
        mediaId: document?.mediaId ?? null,
      };
    });
  }
}
