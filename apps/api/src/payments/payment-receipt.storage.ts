import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  type DownloadedMedia,
  type PaymentReceiptStorage,
  type StoredDocument,
} from '@preztiaos/application';
import {
  buildMinioClient,
  encryptAtRest,
  ensureBucket,
} from '../shared/minio-encrypted-storage';

/**
 * Adaptador del puerto PaymentReceiptStorage: guarda el comprobante de pago en
 * MinIO cifrado en reposo (AES-256-GCM, mismo esquema que los documentos KYC).
 * El comprobante es EVIDENCIA: se guarda siempre, también cuando se rechaza.
 */
@Injectable()
export class MinioPaymentReceiptStorage implements PaymentReceiptStorage {
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';
  private bucketReady?: Promise<void>;

  async store(input: {
    tenantId: string;
    creditId: string | null;
    media: DownloadedMedia;
  }): Promise<StoredDocument> {
    if (!this.bucketReady)
      this.bucketReady = ensureBucket(this.client, this.bucket);
    await this.bucketReady;

    // Cada comprobante es un objeto propio (puede haber varios por crédito).
    const scope = input.creditId ?? 'unassigned';
    const storageKey = `payments/${input.tenantId}/${scope}/${randomUUID()}`;

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
}
