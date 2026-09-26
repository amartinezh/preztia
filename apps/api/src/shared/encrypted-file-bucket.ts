import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  buildMinioClient,
  decryptAtRest,
  encryptAtRest,
  ensureBucket,
} from './minio-encrypted-storage';

/**
 * Bucket de EVIDENCIA cifrada en reposo (AES-256-GCM, mismo esquema que KYC): comprobantes que
 * sube el personal (gastos, consignaciones). Guarda y recupera por clave; quien lo usa decide la
 * clave (prefijada por tenant, para la purga) y el control de acceso. Nunca loguea el binario.
 */
export class EncryptedFileBucket {
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';
  private bucketReady?: Promise<void>;

  /** Guarda el archivo cifrado; devuelve su sha256 (huella del original, para auditoría). */
  async put(
    key: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<{ sha256: string }> {
    if (!this.bucketReady)
      this.bucketReady = ensureBucket(this.client, this.bucket);
    await this.bucketReady;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: encryptAtRest(bytes),
        ContentType: mimeType,
        Metadata: { sha256 },
      }),
    );
    return { sha256 };
  }

  /** Recupera y descifra el archivo; 404 si no se puede leer. */
  async get(key: string): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const sealed = await object.Body?.transformToByteArray();
    if (!sealed) {
      throw new NotFoundException('No se pudo leer el comprobante almacenado');
    }
    return decryptAtRest(sealed);
  }
}
