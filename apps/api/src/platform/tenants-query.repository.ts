import { Injectable } from '@nestjs/common';
import { count, desc } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { TenantOutput } from '@preztiaos/contracts';
import { withPlatformTx } from './platform-uow';

// Read model del plano de control: listado paginado de TODOS los tenants (BYPASSRLS).
@Injectable()
export class TenantsQueryRepository {
  async listTenants(input: {
    page: number;
    pageSize: number;
  }): Promise<{ items: TenantOutput[]; total: number }> {
    return withPlatformTx(async (tx) => {
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.tenant);
      const rows = await tx
        .select()
        .from(schema.tenant)
        .orderBy(desc(schema.tenant.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const items: TenantOutput[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
