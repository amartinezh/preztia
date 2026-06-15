import { Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  BorrowerListSummary,
  BorrowerSummary,
} from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read models de LISTAS: catálogo con número de miembros y miembros (clientes) de una lista.
@Injectable()
export class BorrowerListsQueryRepository {
  async listLists(tenantId: string): Promise<BorrowerListSummary[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.borrowerList.id,
          name: schema.borrowerList.name,
          createdAt: schema.borrowerList.createdAt,
          memberCount: count(schema.borrowerListMember.id),
        })
        .from(schema.borrowerList)
        .leftJoin(
          schema.borrowerListMember,
          eq(schema.borrowerListMember.listId, schema.borrowerList.id),
        )
        .groupBy(schema.borrowerList.id)
        .orderBy(desc(schema.borrowerList.createdAt));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        memberCount: Number(row.memberCount),
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  async listMembers(input: {
    tenantId: string;
    listId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: BorrowerSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = eq(schema.borrowerListMember.listId, input.listId);
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.borrowerListMember)
        .where(where);
      const rows = await tx
        .select({ borrower: schema.borrower })
        .from(schema.borrowerListMember)
        .innerJoin(
          schema.borrower,
          eq(schema.borrower.id, schema.borrowerListMember.borrowerId),
        )
        .where(where)
        .orderBy(desc(schema.borrowerListMember.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const items: BorrowerSummary[] = rows.map(({ borrower }) => ({
        id: borrower.id,
        nationalId: borrower.nationalId,
        firstName: borrower.firstName,
        lastName: borrower.lastName,
        business: borrower.business,
        phone: borrower.phone,
        lat: borrower.lat,
        lng: borrower.lng,
        color: borrower.color,
        creditBlocked: borrower.creditBlocked,
        creditLimitMinor: borrower.creditLimitMinor,
        createdAt: borrower.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
