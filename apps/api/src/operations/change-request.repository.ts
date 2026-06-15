import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ChangeRequestRecord,
  ChangeRequestStore,
  NewChangeRequest,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Adaptador del puerto ChangeRequestStore: opera `change_request` bajo el rol `app` + RLS.
@Injectable()
export class ChangeRequestDrizzleRepository implements ChangeRequestStore {
  async create(request: NewChangeRequest): Promise<void> {
    await withTenantTxFor(request.tenantId, async (tx) => {
      await tx.insert(schema.changeRequest).values({
        id: request.id,
        tenantId: request.tenantId,
        borrowerId: request.borrowerId,
        requestedBy: request.requestedBy,
        changes: request.changes,
      });
    });
  }

  async findById(input: {
    tenantId: string;
    requestId: string;
  }): Promise<ChangeRequestRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.changeRequest)
        .where(eq(schema.changeRequest.id, input.requestId))
        .limit(1);
      return row ? toRecord(row) : null;
    });
  }

  async updateReview(input: {
    tenantId: string;
    requestId: string;
    status: ChangeRequestRecord['status'];
    reviewedBy: string;
    reviewedAt: Date;
  }): Promise<ChangeRequestRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.changeRequest)
        .set({
          status: input.status,
          reviewedBy: input.reviewedBy,
          reviewedAt: input.reviewedAt,
        })
        .where(eq(schema.changeRequest.id, input.requestId))
        .returning();
      return row ? toRecord(row) : null;
    });
  }
}

function toRecord(
  row: typeof schema.changeRequest.$inferSelect,
): ChangeRequestRecord {
  return {
    id: row.id,
    borrowerId: row.borrowerId,
    requestedBy: row.requestedBy,
    changes: row.changes,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
