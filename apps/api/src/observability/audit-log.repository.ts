import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';

export interface AuditEntry {
  tenantId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  correlationId: string | null;
}

// Adaptador de la bitácora append-only `audit_log` (INSERT bajo el rol `app` + RLS). El rol no
// puede editar/borrar (revocado en la migración): el historial es inmutable.
@Injectable()
export class AuditLogRepository {
  async record(entry: AuditEntry): Promise<void> {
    await withTenantTxFor(entry.tenantId, async (tx) => {
      await tx.insert(schema.auditLog).values({
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        payload: entry.payload,
        correlationId: entry.correlationId,
      });
    });
  }
}
