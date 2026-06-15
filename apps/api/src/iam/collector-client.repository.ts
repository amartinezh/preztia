import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CollectorAssignmentStore } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Adaptador del puerto CollectorAssignmentStore: reemplaza atómicamente la cartera de
// clientes de un cobrador (borra los previos, inserta los nuevos) bajo RLS.
@Injectable()
export class CollectorClientRepository implements CollectorAssignmentStore {
  async replaceAssignments(input: {
    tenantId: string;
    collectorId: string;
    assignedBy: string;
    borrowerIds: readonly string[];
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .delete(schema.collectorClient)
        .where(eq(schema.collectorClient.collectorId, input.collectorId));
      if (input.borrowerIds.length === 0) return;
      await tx.insert(schema.collectorClient).values(
        input.borrowerIds.map((borrowerId) => ({
          tenantId: input.tenantId,
          collectorId: input.collectorId,
          borrowerId,
          assignedBy: input.assignedBy,
        })),
      );
    });
  }
}
