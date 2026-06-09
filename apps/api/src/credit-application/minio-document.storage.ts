import { Injectable } from '@nestjs/common';
import { createCipheriv, randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  type DocumentStorage,
  type DownloadedMedia,
  type StoredDocument,
} from '@preztiaos/application';
import { type RequiredDocumentType } from '@preztiaos/domain';

const IV_BYTES = 12; // tamaño recomendado para AES-GCM
const KEY_BYTES = 32; // AES-256

/**
 * Adaptador del puerto DocumentStorage: guarda el documento KYC en MinIO (S3) con
 * cifrado en reposo. El binario se cifra a nivel de aplicación con AES-256-GCM antes
 * de subirlo (el objeto almacenado es `iv || authTag || ciphertext`), de modo que la
 * confidencialidad no depende de la configuración del bucket.
 */
@Injectable()
export class MinioDocumentStorage implements DocumentStorage {
  private readonly client = buildClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';
  private bucketReady?: Promise<void>;

  async store(input: {
    tenantId: string;
    applicationId: string;
    documentType: RequiredDocumentType;
    media: DownloadedMedia;
  }): Promise<StoredDocument> {
    await this.ensureBucket();

    const storageKey = `${input.tenantId}/${input.applicationId}/${input.documentType}`;
    const body = encryptAtRest(input.media.bytes);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: body,
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

  // Crea el bucket de KYC la primera vez (memoizado); ignora si ya existe.
  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = this.client
        .send(new CreateBucketCommand({ Bucket: this.bucket }))
        .then(() => undefined)
        .catch((err: { name?: string }) => {
          const owned =
            err.name === 'BucketAlreadyOwnedByYou' ||
            err.name === 'BucketAlreadyExists';
          if (!owned) throw err;
        });
    }
    return this.bucketReady;
  }
}

function buildClient(): S3Client {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1', // MinIO lo ignora, pero el SDK lo exige
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio12345',
    },
  });
}

function encryptAtRest(plaintext: Uint8Array): Buffer {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function loadKey(): Buffer {
  const raw = process.env.KYC_ENCRYPTION_KEY;
  if (!raw)
    throw new Error(
      'KYC_ENCRYPTION_KEY no configurada: los documentos KYC deben cifrarse en reposo',
    );
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `KYC_ENCRYPTION_KEY debe ser de ${KEY_BYTES} bytes en base64`,
    );
  }
  return key;
}
