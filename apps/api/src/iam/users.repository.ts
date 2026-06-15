import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { NewUser, UserRecord, UserStore } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { mapUniqueViolation } from '../shared/persistence-errors';

// Adaptador del puerto UserStore para el PLANO DE DATOS: opera `app_user` bajo el rol `app`
// + RLS (toda escritura con el tenant del actor). No contiene reglas de negocio.
@Injectable()
export class UserDrizzleRepository implements UserStore {
  async create(user: NewUser): Promise<void> {
    await mapUniqueViolation(
      () =>
        withTenantTxFor(user.tenantId, async (tx) => {
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
  }): Promise<UserRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.appUser)
        .set({
          ...(input.zonePaths !== undefined
            ? { zonePaths: [...input.zonePaths] }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.appUser.id, input.userId))
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async findById(input: {
    tenantId: string;
    userId: string;
  }): Promise<UserRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.appUser)
        .where(eq(schema.appUser.id, input.userId))
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
