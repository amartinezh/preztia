import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';

export interface StoredResponse {
  status: number;
  response: unknown;
}

// Adaptador de `idempotency_key`: guarda/recupera el resultado de una operación de dinero por
// `Idempotency-Key`. Bajo el rol `app` + RLS. Único por (tenant, key).
@Injectable()
export class IdempotencyRepository {
  async find(tenantId: string, key: string): Promise<StoredResponse | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          status: schema.idempotencyKey.status,
          response: schema.idempotencyKey.response,
        })
        .from(schema.idempotencyKey)
        .where(
          and(
            eq(schema.idempotencyKey.tenantId, tenantId),
            eq(schema.idempotencyKey.key, key),
          ),
        )
        .limit(1);
      return row ? { status: row.status, response: row.response } : null;
    });
  }

  async save(input: {
    tenantId: string;
    key: string;
    method: string;
    path: string;
    status: number;
    response: unknown;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .insert(schema.idempotencyKey)
        .values({
          tenantId: input.tenantId,
          key: input.key,
          method: input.method,
          path: input.path,
          status: input.status,
          response: input.response,
        })
        // Si otra petición concurrente ya guardó esta clave, no se duplica (índice único).
        .onConflictDoNothing();
    });
  }
}
