import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import type { CollectionVisitAuditLog } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto `CollectionVisitAuditLog`: registra cada visita en `audit_log` (append-only;
 * la migración revoca UPDATE/DELETE al rol `app`). Deja traza de quién/qué/cuándo (el cobrador, el
 * crédito y el nivel de mora al visitar), sin PII.
 */
@Injectable()
export class CollectionVisitAuditLogAdapter implements CollectionVisitAuditLog {
  async recordVisit(input: {
    tenantId: string;
    creditId: string;
    collectorId: string;
    overdueCountAtVisit: number;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.collectorId,
        action: 'MARK collection-visit',
        entity: 'collection-visit',
        entityId: input.creditId,
        payload: { overdueCountAtVisit: input.overdueCountAtVisit },
      });
    });
  }
}
