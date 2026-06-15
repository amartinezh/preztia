import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { NewUser, UserRecord, UserStore } from '@preztiaos/application';
import { withPlatformTx } from './platform-uow';
import { mapUniqueViolation } from '../shared/persistence-errors';

// Adaptador del puerto UserStore para el PLANO DE CONTROL: provisiona usuarios (admins)
// en CUALQUIER tenant vía la conexión BYPASSRLS. El plano de datos usa su propio
// adaptador con RLS; este solo lo emplea `CreateTenantAdminHandler`.
@Injectable()
export class PlatformUserRepository implements UserStore {
  async create(user: NewUser): Promise<void> {
    await mapUniqueViolation(
      () =>
        withPlatformTx(async (tx) => {
          await tx.insert(schema.appUser).values({
            id: user.id,
            tenantId: user.tenantId,
            email: user.email,
            passwordHash: user.passwordHash,
            role: user.role,
            zonePaths: [...user.zonePaths],
          });
        }),
      'Ya existe un usuario con ese email',
    );
  }

  async update(input: {
    tenantId: string;
    userId: string;
    zonePaths?: readonly string[];
    active?: boolean;
    passwordHash?: string;
  }): Promise<UserRecord | null> {
    return withPlatformTx(async (tx) => {
      const [row] = await tx
        .update(schema.appUser)
        .set({
          ...(input.zonePaths !== undefined
            ? { zonePaths: [...input.zonePaths] }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.passwordHash !== undefined
            ? { passwordHash: input.passwordHash }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.appUser.id, input.userId),
            eq(schema.appUser.tenantId, input.tenantId),
          ),
        )
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async findById(input: {
    tenantId: string;
    userId: string;
  }): Promise<UserRecord | null> {
    return withPlatformTx(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.appUser)
        .where(
          and(
            eq(schema.appUser.id, input.userId),
            eq(schema.appUser.tenantId, input.tenantId),
          ),
        )
        .limit(1);
      return row ? toRecord(row) : null;
    });
  }
}

function toRecord(row: typeof schema.appUser.$inferSelect): UserRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    zonePaths: row.zonePaths,
    active: row.active,
  };
}
