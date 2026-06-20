import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import type {
  CollectionAuditLog,
  CollectionReminderTrigger,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto CollectionAuditLog: registra el envío de cada recordatorio en `audit_log`
 * (append-only; la migración revoca UPDATE/DELETE al rol `app`). Deja trazabilidad de quién/qué/
 * cuándo: el actor (manual) o `null` (cron), el crédito afectado y el monto cobrado, sin PII.
 */
@Injectable()
export class CollectionAuditLogAdapter implements CollectionAuditLog {
  async recordReminderSent(input: {
    tenantId: string;
    creditId: string;
    actorId: string | null;
    trigger: CollectionReminderTrigger;
    dueMinor: number;
    currency: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'SEND collection-reminder',
        entity: 'collection-reminder',
        entityId: input.creditId,
        payload: {
          trigger: input.trigger,
          dueMinor: input.dueMinor,
          currency: input.currency,
        },
      });
    });
  }
}
