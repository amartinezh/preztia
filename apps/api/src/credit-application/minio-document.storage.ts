import { Injectable } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  type DocumentStorage,
  type DownloadedMedia,
  type StoredDocument,
} from '@preztiaos/application';
import { type RequiredDocumentType } from '@preztiaos/domain';
import {
  buildMinioClient,
  encryptAtRest,
  ensureBucket,
} from '../shared/minio-encrypted-storage';

/**
 * Adaptador del puerto DocumentStorage: guarda el documento KYC en MinIO (S3) con
 * cifrado en reposo. El binario se cifra a nivel de aplicación con AES-256-GCM antes
 * de subirlo (el objeto almacenado es `iv || authTag || ciphertext`), de modo que la
 * confidencialidad no depende de la configuración del bucket.
 */
@Injectable()
export class MinioDocumentStorage implements DocumentStorage {
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';
  private bucketReady?: Promise<void>;

  async store(input: {
    tenantId: string;
    applicationId: string;
    documentType: RequiredDocumentType;
    slot: number;
    media: DownloadedMedia;
  }): Promise<StoredDocument> {
    if (!this.bucketReady)
      this.bucketReady = ensureBucket(this.client, this.bucket);
    await this.bucketReady;

    // El cupo forma parte de la clave: sin él, el reverso sobrescribiría al anverso.
    // El cupo 1 conserva la clave histórica para no invalidar lo ya almacenado.
    const base = `${input.tenantId}/${input.applicationId}/${input.documentType}`;
    const storageKey = input.slot > 1 ? `${base}/${input.slot}` : base;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: encryptAtRest(input.media.bytes),
        ContentType: input.media.mimeType,
        Metadata: { sha256: input.media.sha256 },
      }),
    );

    return { storageKey, sha256: input.media.sha256 };
  }

  // TODO(fase posterior): retención / borrado automático de documentos KYC.
  // Opción recomendada: regla de ciclo de vida (lifecycle/expiration) del bucket S3/MinIO
  // que expira los objetos tras N días, complementada con un job programado que también
  // limpie las filas/metadatos en BD. Debe quedar auditado (qué se borró y cuándo) y
  // respetar requisitos legales de retención antes de eliminar.
}
