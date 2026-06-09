import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type AntifraudInput,
  type AntifraudService,
} from '@preztiaos/application';
import { type FraudAssessment, type FraudStatus } from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

const MIN_BYTES = 1024; // 1 KB: descarta archivos vacíos o truncados
const DEFAULT_MAX_MB = 25; // si KYC_MAX_FILE_MB no está configurado

// Tamaño máximo del documento, configurable por entorno (KYC_MAX_FILE_MB).
function maxBytesFromEnv(): number {
  const mb = Number(process.env.KYC_MAX_FILE_MB);
  const valid = Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB;
  return valid * 1024 * 1024;
}

// Aceptamos el mayor número de formatos posible: CUALQUIER imagen (las fotos de
// celular llegan en múltiples formatos —jpeg, png, webp, heic/heif, etc.—) y PDF.
// La identificación real del documento (caso Brasil) la hará la IA más adelante.
function isAcceptedFormat(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf';
}

const SCORE_REJECTED = 100;
const SCORE_SUSPICIOUS = 60;
const SCORE_APPROVED = 0;

/**
 * Adaptador del puerto AntifraudService: validaciones estructurales del documento.
 *
 * Esta línea base verifica formato/tamaño y detecta reutilización del mismo binario
 * (sha256) en otra solicitud — señal de suplantación. Es el punto de extensión donde
 * más adelante se conectará OCR / verificación de identidad real.
 */
@Injectable()
export class StructuralAntifraudService implements AntifraudService {
  async assess(input: AntifraudInput): Promise<FraudAssessment> {
    const reasons: string[] = [];
    const maxBytes = maxBytesFromEnv();

    if (!isAcceptedFormat(input.mimeType)) {
      reasons.push(`formato no permitido (${input.mimeType})`);
    }
    if (input.sizeBytes > maxBytes)
      reasons.push(`el archivo supera el tamaño máximo (${maxBytes / (1024 * 1024)} MB)`);
    if (input.sizeBytes < MIN_BYTES)
      reasons.push('el archivo está vacío o es ilegible');

    // Violaciones duras: rechazo inmediato sin consultar la BD.
    if (reasons.length > 0)
      return assessment('rejected', SCORE_REJECTED, reasons);

    const reused = await this.isReusedAcrossApplications(input);
    if (reused) {
      return assessment('suspicious', SCORE_SUSPICIOUS, [
        'el documento ya fue usado en otra solicitud',
      ]);
    }

    return assessment('approved', SCORE_APPROVED, []);
  }

  // ¿El mismo binario (sha256) aparece ya en una solicitud distinta del tenant?
  private async isReusedAcrossApplications(
    input: AntifraudInput,
  ): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.creditApplicationDocument.id })
        .from(schema.creditApplicationDocument)
        .where(
          and(
            eq(schema.creditApplicationDocument.sha256, input.sha256),
            ne(
              schema.creditApplicationDocument.applicationId,
              input.applicationId,
            ),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }
}

function assessment(
  status: FraudStatus,
  score: number,
  reasons: string[],
): FraudAssessment {
  return { status, score, reasons };
}
