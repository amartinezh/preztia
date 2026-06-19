import { Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import {
  buildMinioClient,
  decryptAtRest,
} from '../shared/minio-encrypted-storage';

/** Binario del comprobante de pago descifrado, listo para que el revisor lo vea/haga zoom. */
export interface OriginalReceipt {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

/**
 * Recupera el comprobante de pago original: localiza su `storage_key` bajo RLS, descarga el objeto
 * cifrado de MinIO y lo DESCIFRA (AES-256-GCM). El binario es PII/evidencia: nunca se loguea ni
 * se cachea (`no-store` en la frontera).
 */
@Injectable()
export class PaymentReceiptOriginalStorage {
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';

  async fetch(input: {
    tenantId: string;
    paymentId: string;
  }): Promise<OriginalReceipt> {
    const [row] = await withTenantTxFor(input.tenantId, async (tx) =>
      tx
        .select({
          storageKey: schema.payment.storageKey,
          mimeType: schema.payment.mimeType,
        })
        .from(schema.payment)
        .where(eq(schema.payment.id, input.paymentId))
        .limit(1),
    );
    if (!row?.storageKey) {
      throw new NotFoundException('El comprobante no tiene imagen almacenada');
    }

    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: row.storageKey }),
    );
    const sealed = await object.Body?.transformToByteArray();
    if (!sealed) {
      throw new NotFoundException('No se pudo leer el comprobante almacenado');
    }
    return {
      bytes: decryptAtRest(sealed),
      mimeType: row.mimeType ?? 'application/octet-stream',
    };
  }
}
