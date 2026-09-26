import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ExpenseReceiptStorage,
  StoredExpenseReceipt,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { EncryptedFileBucket } from '../shared/encrypted-file-bucket';

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
  private readonly files = new EncryptedFileBucket();

  async store(input: {
    tenantId: string;
    expenseId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<StoredExpenseReceipt> {
    const storageKey = `expenses/${input.tenantId}/${input.expenseId}`;
    const { sha256 } = await this.files.put(
      storageKey,
      input.bytes,
      input.mimeType,
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
    return {
      bytes: await this.files.get(row.storageKey),
      mimeType: row.mimeType ?? 'application/octet-stream',
    };
  }
}
