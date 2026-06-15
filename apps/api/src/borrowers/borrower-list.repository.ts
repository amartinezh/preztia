import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { BorrowerListStore } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { mapUniqueViolation } from '../shared/persistence-errors';

// Adaptador del puerto BorrowerListStore: opera `borrower_list`/`borrower_list_member` bajo el
// rol `app` + RLS. Sin reglas de negocio.
@Injectable()
export class BorrowerListDrizzleRepository implements BorrowerListStore {
  async createList(input: {
    id: string;
    tenantId: string;
    name: string;
  }): Promise<void> {
    await mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          await tx.insert(schema.borrowerList).values({
            id: input.id,
            tenantId: input.tenantId,
            name: input.name,
          });
        }),
      'Ya existe una lista con ese nombre',
    );
  }

  async deleteList(input: {
    tenantId: string;
    listId: string;
  }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .delete(schema.borrowerListMember)
        .where(eq(schema.borrowerListMember.listId, input.listId));
      const deleted = await tx
        .delete(schema.borrowerList)
        .where(eq(schema.borrowerList.id, input.listId))
        .returning({ id: schema.borrowerList.id });
      return deleted.length > 0;
    });
  }

  async findList(input: {
    tenantId: string;
    listId: string;
  }): Promise<{ id: string } | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.borrowerList.id })
        .from(schema.borrowerList)
        .where(eq(schema.borrowerList.id, input.listId))
        .limit(1);
      return row ?? null;
    });
  }

  async addMembers(input: {
    tenantId: string;
    listId: string;
    borrowerIds: readonly string[];
  }): Promise<number> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.borrowerListMember)
        .values(
          input.borrowerIds.map((borrowerId) => ({
            tenantId: input.tenantId,
            listId: input.listId,
            borrowerId,
          })),
        )
        // Idempotente: ignora los que ya eran miembros (índice único list_id+borrower_id).
        .onConflictDoNothing()
        .returning({ id: schema.borrowerListMember.id });
      return inserted.length;
    });
  }

  async removeMember(input: {
    tenantId: string;
    listId: string;
    borrowerId: string;
  }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const removed = await tx
        .delete(schema.borrowerListMember)
        .where(
          and(
            eq(schema.borrowerListMember.listId, input.listId),
            eq(schema.borrowerListMember.borrowerId, input.borrowerId),
          ),
        )
        .returning({ id: schema.borrowerListMember.id });
      return removed.length > 0;
    });
  }
}
