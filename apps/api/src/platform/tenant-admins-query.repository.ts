import { Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { TenantAdminOutput } from '@preztiaos/contracts';
import { withPlatformTx } from './platform-uow';

// Read model del plano de control: listado paginado de los ADMINS de un tenant (BYPASSRLS).
// Solo expone usuarios con rol ADMIN; coordinadores/cobradores se gestionan en el plano de datos.
@Injectable()
export class TenantAdminsQueryRepository {
  async listTenantAdmins(input: {
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: TenantAdminOutput[]; total: number }> {
    const filter = and(
      eq(schema.appUser.tenantId, input.tenantId),
      eq(schema.appUser.role, 'ADMIN'),
    );
    return withPlatformTx(async (tx) => {
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
      const items: TenantAdminOutput[] = rows.map((row) => ({
        id: row.id,
        email: row.email,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
