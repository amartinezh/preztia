import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ExpenseReceiptStorage,
  StoredExpenseReceipt,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import {
  buildMinioClient,
  decryptAtRest,
  encryptAtRest,
  ensureBucket,
} from '../shared/minio-encrypted-storage';

/** Binario del comprobante descifrado, listo para que el revisor lo vea. */
export interface ExpenseReceiptOriginal {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

/**
 * Adaptador del puerto `ExpenseReceiptStorage`: guarda el comprobante del gasto en MinIO CIFRADO en
 * reposo (AES-256-GCM, mismo esquema que KYC y comprobantes de pago) y lo recupera descifrado bajo
 * RLS y el alcance de quien lo pide. El binario es evidencia: nunca se loguea ni se cachea.
 */
@Injectable()
export class MinioExpenseReceiptStorage implements ExpenseReceiptStorage {
  private readonly client = buildMinioClient();
  private readonly bucket = process.env.MINIO_BUCKET_KYC ?? 'kyc-documents';
  private bucketReady?: Promise<void>;

  async store(input: {
    tenantId: string;
    expenseId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<StoredExpenseReceipt> {
    if (!this.bucketReady)
      this.bucketReady = ensureBucket(this.client, this.bucket);
    await this.bucketReady;

    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const storageKey = `expenses/${input.tenantId}/${input.expenseId}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: encryptAtRest(input.bytes),
        ContentType: input.mimeType,
        Metadata: { sha256 },
      }),
    );
    return { storageKey, mimeType: input.mimeType, sha256 };
  }

  /**
   * Comprobante descifrado del gasto, si está dentro del alcance (`access`: el propio solicitante,
   * el subárbol del coordinador o todo el tenant para el ADMIN). Fuera de alcance → 404.
   */
  async fetch(input: {
    tenantId: string;
    expenseId: string;
    access: SQL | undefined;
  }): Promise<ExpenseReceiptOriginal> {
    const [row] = await withTenantTxFor(input.tenantId, async (tx) =>
      tx
        .select({
          storageKey: schema.expense.receiptStorageKey,
          mimeType: schema.expense.receiptMimeType,
        })
        .from(schema.expense)
        .leftJoin(schema.zone, eq(schema.zone.id, schema.expense.zoneId))
        .where(and(eq(schema.expense.id, input.expenseId), input.access))
        .limit(1),
    );
    if (!row?.storageKey) {
      throw new NotFoundException('El gasto no tiene comprobante');
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
