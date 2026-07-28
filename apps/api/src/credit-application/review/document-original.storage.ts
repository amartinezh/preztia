import { Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../../tenancy/unit-of-work';
import {
  buildMinioClient,
  decryptAtRest,
} from '../../shared/minio-encrypted-storage';

/** Binario original descifrado de un documento KYC, listo para servir al analista. */
export interface OriginalDocument {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

/**
 * Recupera el documento KYC original que subió el solicitante: localiza su `storage_key`
 * bajo RLS, descarga el objeto cifrado de MinIO y lo DESCIFRA (AES-256-GCM) para que el
 * coordinador pueda verlo. El binario nunca se loguea ni se cachea (PII en reposo).
 */
@Injectable()
export class DocumentOriginalStorage {
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';

  async fetch(input: {
    tenantId: string;
    applicationId: string;
    documentType: string;
    /** Archivo dentro del documento (1 = anverso). Por defecto, el primero. */
    slot?: number;
  }): Promise<OriginalDocument> {
    const slot = input.slot ?? 1;

    // RLS ya acota al tenant; se busca el archivo por (documento, cupo). Un documento puede
    // constar de varios (anverso/reverso) y el analista debe poder abrir cualquiera.
    const files = await withTenantTxFor(input.tenantId, async (tx) =>
      tx
        .select({
          documentType: schema.creditApplicationDocumentFile.documentType,
          slot: schema.creditApplicationDocumentFile.slot,
          storageKey: schema.creditApplicationDocumentFile.storageKey,
          mimeType: schema.creditApplicationDocumentFile.mimeType,
        })
        .from(schema.creditApplicationDocumentFile)
        .where(
          eq(
            schema.creditApplicationDocumentFile.applicationId,
            input.applicationId,
          ),
        ),
    );

    const target =
      files.find(
        (f) => f.documentType === input.documentType && f.slot === slot,
      ) ?? (slot === 1 ? await this.legacyFile(input) : null);

    if (!target?.storageKey) {
      throw new NotFoundException('El documento no tiene original almacenado');
    }

    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: target.storageKey }),
    );
    const sealed = await object.Body?.transformToByteArray();
    if (!sealed) {
      throw new NotFoundException('No se pudo leer el documento almacenado');
    }

    return {
      bytes: decryptAtRest(sealed),
      mimeType: target.mimeType ?? 'application/octet-stream',
    };
  }

  /**
   * Expedientes anteriores a los documentos de varios archivos: su único binario vive en las
   * columnas de `credit_application_document`, sin fila en la tabla de archivos. Se sirven desde
   * ahí para que el historial ya almacenado siga viéndose.
   */
  private async legacyFile(input: {
    tenantId: string;
    applicationId: string;
    documentType: string;
  }): Promise<{ storageKey: string | null; mimeType: string | null } | null> {
    const documents = await withTenantTxFor(input.tenantId, async (tx) =>
      tx
        .select({
          documentType: schema.creditApplicationDocument.documentType,
          storageKey: schema.creditApplicationDocument.storageKey,
          mimeType: schema.creditApplicationDocument.mimeType,
        })
        .from(schema.creditApplicationDocument)
        .where(
          eq(
            schema.creditApplicationDocument.applicationId,
            input.applicationId,
          ),
        ),
    );
    return documents.find((d) => d.documentType === input.documentType) ?? null;
  }
}
