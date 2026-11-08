import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CollectorAssignmentStore } from '@preztiaos/application';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';

// Adaptador del puerto CollectorAssignmentStore: la cartera de clientes de un cobrador bajo RLS.
// Reemplazo completo (borra los previos, inserta los nuevos) o ajuste por deltas (agrega/quita),
// cada uno en una sola transacción.
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

  async updateAssignments(input: {
    tenantId: string;
    collectorId: string;
    assignedBy: string;
    add: readonly string[];
    remove: readonly string[];
  }): Promise<{ assigned: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      if (input.remove.length > 0) {
        await tx
          .delete(schema.collectorClient)
          .where(
            and(
              eq(schema.collectorClient.collectorId, input.collectorId),
              inArray(schema.collectorClient.borrowerId, [...input.remove]),
            ),
          );
      }
      if (input.add.length > 0) {
        // Idempotente: el índice único (tenant, cobrador, cliente) convierte un reintento o un
        // cliente ya asignado en un no-op, en vez de un 500.
        await tx
          .insert(schema.collectorClient)
          .values(
            input.add.map((borrowerId) => ({
              tenantId: input.tenantId,
              collectorId: input.collectorId,
              borrowerId,
              assignedBy: input.assignedBy,
            })),
          )
          .onConflictDoNothing();
      }
      return { assigned: await countAssigned(tx, input.collectorId) };
    });
  }
}

/** Clientes asignados al cobrador tras la operación (misma transacción: lectura consistente). */
async function countAssigned(tx: Tx, collectorId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(schema.collectorClient)
    .where(eq(schema.collectorClient.collectorId, collectorId));
  return Number(row?.value ?? 0);
}
