import { Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { UserSummary } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read model de usuarios del tenant: listado paginado. RLS garantiza que solo aparecen los
// usuarios del tenant (los SUPER_ADMIN tienen tenant_id NULL y quedan ocultos).
@Injectable()
export class UsersQueryRepository {
  async listUsers(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    role?: UserSummary['role'];
  }): Promise<{ items: UserSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const filter = input.role
        ? eq(schema.appUser.role, input.role)
        : undefined;
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.appUser)
        .where(filter);
      const rows = await tx
        .select()
        .from(schema.appUser)
        .where(filter)
        .orderBy(desc(schema.appUser.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const items: UserSummary[] = rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        zonePaths: row.zonePaths,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
