import { Injectable, Logger } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type DocumentReviewJob,
  type DocumentReviewResult,
  type DocumentReviewer,
} from '@preztiaos/application';
import {
  type AiProvider,
  decideDocumentReview,
  type DocumentIdentification,
  type FraudAssessment,
  isAcceptable,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { decryptSecret } from '../shared/secret-cipher';
import {
  extractWithGemini,
  type GeminiDocumentExtraction,
} from './ai/gemini-document.client';
import { parseFileMetadata } from './validation/file-metadata.parser';

const DEFAULT_MODEL = 'gemini-2.5-flash'; // multimodal (acepta imágenes y PDF)
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_CONFIDENCE = 60; // 0..100; por debajo, "no identificado con claridad"

interface TenantAiCredentials {
  readonly provider: AiProvider;
  readonly apiKey: string;
}

/**
 * Adaptador del puerto DocumentReviewer.
 *
 * Compone la decisión de revisión: (1) si es estructuralmente inválido, no gasta IA;
 * (2) identifica el documento con IA (configurable por tenant) y PERSISTE la extracción
 * para trazabilidad —best-effort: si la IA falla, no bloquea—; (3) cuenta cuántas veces
 * el documento ya no coincidió y aplica la regla pura `decideDocumentReview` del dominio
 * con el máximo de intentos del `.env`.
 */
@Injectable()
export class AiDocumentReviewer implements DocumentReviewer {
  private readonly logger = new Logger('CreditApplication:Review');

  async review(
    job: DocumentReviewJob,
    structural: FraudAssessment,
  ): Promise<DocumentReviewResult> {
    const maxAttempts = this.maxAttempts();

    // Estructuralmente inválido: no gastamos una llamada de IA.
    if (!isAcceptable(structural)) {
      return {
        decision: decideDocumentReview({
          structural,
          identification: null,
          priorMismatchAttempts: 0,
          maxAttempts,
        }),
        identifiedType: null,
      };
    }

    // Intentos previos en que el documento NO coincidió (antes de este envío).
    const priorMismatchAttempts = await this.priorMismatches(job);

    // Identificación con IA (best-effort): si falla, identification=null → no bloquea.
    const extraction = await this.identify(job);
    const identification: DocumentIdentification | null = extraction
      ? {
          matchesExpected: extraction.matchesExpected,
          clearlyIdentified: this.clearlyIdentified(extraction),
        }
      : null;

    const decision = decideDocumentReview({
      structural,
      identification,
      priorMismatchAttempts,
      maxAttempts,
    });
    return { decision, identifiedType: extraction?.identifiedType ?? null };
  }

  // Extrae e identifica con IA y persiste la extracción (trazabilidad). null si falla.
  private async identify(
    job: DocumentReviewJob,
  ): Promise<GeminiDocumentExtraction | null> {
    try {
      const credentials = await this.resolveCredentials(job.tenantId);
      if (!credentials) {
        this.logger.warn(
          `Sin credencial de IA para el tenant ${job.tenantId}; se omite la identificación`,
        );
        return null;
      }
      const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
      const extraction = await this.extract(credentials, model, job);
      await this.persist(job, credentials.provider, model, extraction);
      this.logger.log(
        `📄 Documento ${job.documentType} (app ${job.applicationId}) identificado="${extraction.identifiedType ?? '?'}" coincide=${extraction.matchesExpected} conf=${extraction.confidence}`,
      );
      return extraction;
    } catch (err) {
      this.logger.error(
        `Fallo identificando el documento ${job.documentType} (solicitud ${job.applicationId})`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  private clearlyIdentified(extraction: GeminiDocumentExtraction): boolean {
    const minConfidence = this.minConfidence() / 100;
    return (
      extraction.identifiedType !== null &&
      extraction.confidence >= minConfidence
    );
  }

  private maxAttempts(): number {
    const n = Number(process.env.KYC_MAX_DOCUMENT_ATTEMPTS);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_ATTEMPTS;
  }

  private minConfidence(): number {
    const n = Number(process.env.KYC_MIN_IDENTIFICATION_CONFIDENCE);
    return Number.isFinite(n) && n >= 0 && n <= 100
      ? n
      : DEFAULT_MIN_CONFIDENCE;
  }

  // Cuántas veces este documento ya fue identificado como NO coincidente (bajo RLS).
  private priorMismatches(job: DocumentReviewJob): Promise<number> {
    return withTenantTxFor(job.tenantId, async (tx) => {
      const [row] = await tx
        .select({ value: count() })
        .from(schema.documentExtraction)
        .where(
          and(
            eq(schema.documentExtraction.applicationId, job.applicationId),
            eq(schema.documentExtraction.documentType, job.documentType),
            eq(schema.documentExtraction.matchesExpected, false),
          ),
        );
      return Number(row?.value ?? 0);
    });
  }

  private resolveCredentials(
    tenantId: string,
  ): Promise<TenantAiCredentials | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          provider: schema.tenantConfig.aiProvider,
          apiKey: schema.tenantConfig.aiApiKey,
        })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId));
      if (!row?.apiKey) return null;
      // Credencial de IA cifrada en reposo: se descifra para invocar al proveedor.
      return { provider: row.provider, apiKey: decryptSecret(row.apiKey) };
    });
  }

  // Despacha al proveedor configurado. GEMINI implementado; el resto, punto de extensión.
  private extract(
    credentials: TenantAiCredentials,
    model: string,
    job: DocumentReviewJob,
  ): Promise<GeminiDocumentExtraction> {
    switch (credentials.provider) {
      case 'GEMINI':
        return extractWithGemini({
          apiKey: credentials.apiKey,
          model,
          documentType: job.documentType,
          spec: job.spec,
          media: { bytes: job.media.bytes, mimeType: job.media.mimeType },
        });
      case 'OPENAI':
      case 'CLAUDE':
        throw new Error(
          `Identificación de documentos con '${credentials.provider}' aún no implementada (esta fase usa GEMINI)`,
        );
    }
  }

  private persist(
    job: DocumentReviewJob,
    provider: AiProvider,
    model: string,
    extraction: GeminiDocumentExtraction,
  ): Promise<void> {
    // Etapa 1 del pipeline antifraude: junto con los campos de la IA se persiste
    // la metadata técnica del archivo (Producer/fechas) para el forense local.
    const fileMetadata = parseFileMetadata(job.media.bytes, job.media.mimeType);
    return withTenantTxFor(job.tenantId, async (tx) => {
      await tx.insert(schema.documentExtraction).values({
        tenantId: job.tenantId,
        applicationId: job.applicationId,
        documentType: job.documentType,
        applicantPhone: job.applicantPhone,
        mediaId: job.mediaId,
        provider,
        model,
        identifiedType: extraction.identifiedType,
        matchesExpected: extraction.matchesExpected,
        confidence: Math.round(extraction.confidence * 100),
        fields: extraction.fields,
        fileMetadata: fileMetadata ? { ...fileMetadata } : null,
        rawText: extraction.rawText,
        rawResponse: extraction.raw,
      });
    });
  }
}
