import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { TenantFilePurger } from '@preztiaos/application';
import { buildMinioClient } from '../shared/minio-encrypted-storage';

// Límite duro de la API S3 DeleteObjects: hasta 1000 claves por petición.
const DELETE_BATCH = 1000;

/**
 * Adaptador del puerto `TenantFilePurger`: elimina del bucket KYC todos los objetos del
 * tenant. Las claves están prefijadas por tenant, así que se listan y borran por prefijo:
 *   - `${tenantId}/…`          → documentos KYC de solicitudes
 *   - `payments/${tenantId}/…` → comprobantes de pago
 * Es "best-effort" y va FUERA de la transacción de BD: registra fallos pero no los propaga
 * (un objeto huérfano no tiene referencias y no rompe la integridad).
 */
@Injectable()
export class MinioTenantFilePurger implements TenantFilePurger {
  private readonly logger = new Logger(MinioTenantFilePurger.name);
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';

  async purge(tenantId: string): Promise<number> {
    let deleted = 0;
    for (const prefix of [`${tenantId}/`, `payments/${tenantId}/`]) {
      deleted += await this.deletePrefix(prefix);
    }
    return deleted;
  }

  private async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;
    try {
      do {
        const listed = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: DELETE_BATCH,
          }),
        );
        const keys = (listed.Contents ?? [])
          .map((obj) => obj.Key)
          .filter((key): key is string => Boolean(key));
        if (keys.length > 0) {
          await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
            }),
          );
          deleted += keys.length;
        }
        continuationToken = listed.IsTruncated
          ? listed.NextContinuationToken
          : undefined;
      } while (continuationToken);
    } catch (err) {
      // No hacemos fallar la purga por el almacén de archivos: la BD ya quedó limpia.
      this.logger.warn(
        `No se pudieron purgar objetos con prefijo "${prefix}": ${asMessage(err)}`,
      );
    }
    return deleted;
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
