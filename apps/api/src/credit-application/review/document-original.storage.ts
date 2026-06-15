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
  }): Promise<OriginalDocument> {
    // RLS ya acota al tenant; se leen los documentos del expediente y se elige por tipo.
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

    const target = documents.find((d) => d.documentType === input.documentType);
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
}
