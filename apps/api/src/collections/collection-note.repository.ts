import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CollectionNoteRepository } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto `CollectionNoteRepository`: persiste observaciones de visita en
 * `collection_note` (append-only; la migración revoca UPDATE/DELETE al rol `app`). Solo inserta y
 * lee la más reciente. Todo bajo `withTenantTxFor` (RLS aísla el tenant).
 */
@Injectable()
export class CollectionNoteRepositoryAdapter implements CollectionNoteRepository {
  async add(input: {
    tenantId: string;
    creditId: string;
    borrowerId: string;
    authorId: string;
    body: string;
  }): Promise<{ id: string; createdAt: string }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.collectionNote)
        .values({
          tenantId: input.tenantId,
          creditId: input.creditId,
          borrowerId: input.borrowerId,
          authorId: input.authorId,
          body: input.body,
        })
        .returning({
          id: schema.collectionNote.id,
          createdAt: schema.collectionNote.createdAt,
        });
      return { id: row.id, createdAt: row.createdAt.toISOString() };
    });
  }

  async latestNoteAt(input: {
    tenantId: string;
    creditId: string;
  }): Promise<string | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ createdAt: schema.collectionNote.createdAt })
        .from(schema.collectionNote)
        .where(eq(schema.collectionNote.creditId, input.creditId))
        .orderBy(desc(schema.collectionNote.createdAt))
        .limit(1);
      return row ? row.createdAt.toISOString() : null;
    });
  }
}
