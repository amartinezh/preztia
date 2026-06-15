import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { TenantRecord, TenantStore } from '@preztiaos/application';
import type { TenantStatus } from '@preztiaos/domain';
import { withPlatformTx } from './platform-uow';
import { mapUniqueViolation } from '../shared/persistence-errors';

// Adaptador del puerto TenantStore (plano de control). Opera la tabla GLOBAL `tenant` con
// la conexión BYPASSRLS, de modo que el super admin gestiona todos los tenants.
@Injectable()
export class TenantDrizzleRepository implements TenantStore {
  async create(input: {
    id: string;
    name: string;
    slug: string;
  }): Promise<void> {
    await mapUniqueViolation(
      () =>
        withPlatformTx(async (tx) => {
          await tx.insert(schema.tenant).values({
            id: input.id,
            name: input.name,
            slug: input.slug,
          });
        }),
      'Ya existe un tenant con ese slug',
    );
  }

  async update(input: {
    id: string;
    name?: string;
    status?: TenantStatus;
  }): Promise<TenantRecord | null> {
    return withPlatformTx(async (tx) => {
      const [row] = await tx
        .update(schema.tenant)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.tenant.id, input.id))
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async remove(id: string): Promise<boolean> {
    return withPlatformTx(async (tx) => {
      const deleted = await tx
        .delete(schema.tenant)
        .where(eq(schema.tenant.id, id))
        .returning({ id: schema.tenant.id });
      return deleted.length > 0;
    });
  }

  async findById(id: string): Promise<TenantRecord | null> {
    return withPlatformTx(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.tenant)
        .where(eq(schema.tenant.id, id))
        .limit(1);
      return row ? toRecord(row) : null;
    });
  }
}

function toRecord(row: typeof schema.tenant.$inferSelect): TenantRecord {
  return { id: row.id, name: row.name, slug: row.slug, status: row.status };
}
