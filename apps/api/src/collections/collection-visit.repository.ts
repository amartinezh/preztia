import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CollectionVisitRepository } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto `CollectionVisitRepository`: persiste el evento "visitado" en
 * `collection_visit` (append-only; la migración revoca UPDATE/DELETE al rol `app`) y lee la última
 * visita del crédito para el reagendamiento por ciclo. Todo bajo `withTenantTxFor` (RLS).
 */
@Injectable()
export class CollectionVisitRepositoryAdapter implements CollectionVisitRepository {
  async record(input: {
    tenantId: string;
    creditId: string;
    borrowerId: string;
    collectorId: string;
    overdueCountAtVisit: number;
    daysOverdueAtVisit: number;
  }): Promise<{ id: string; visitedAt: string }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.collectionVisit)
        .values({
          tenantId: input.tenantId,
          creditId: input.creditId,
          borrowerId: input.borrowerId,
          collectorId: input.collectorId,
          overdueCountAtVisit: input.overdueCountAtVisit,
          daysOverdueAtVisit: input.daysOverdueAtVisit,
        })
        .returning({
          id: schema.collectionVisit.id,
          visitedAt: schema.collectionVisit.visitedAt,
        });
      return { id: row.id, visitedAt: row.visitedAt.toISOString() };
    });
  }

  async lastVisit(input: {
    tenantId: string;
    creditId: string;
  }): Promise<{ overdueCountAtVisit: number; visitedAt: string } | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          overdueCountAtVisit: schema.collectionVisit.overdueCountAtVisit,
          visitedAt: schema.collectionVisit.visitedAt,
        })
        .from(schema.collectionVisit)
        .where(eq(schema.collectionVisit.creditId, input.creditId))
        .orderBy(desc(schema.collectionVisit.visitedAt))
        .limit(1);
      if (!row) return null;
      return {
        overdueCountAtVisit: row.overdueCountAtVisit,
        visitedAt: row.visitedAt.toISOString(),
      };
    });
  }
}
