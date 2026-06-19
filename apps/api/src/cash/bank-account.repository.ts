import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { BankAccount, BankAccountInput } from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';

type Row = typeof schema.tenantBankAccount.$inferSelect;

/** Patch parcial de una cuenta. `null` en pixKey/apiKey/accountNumber borra el valor. */
export interface BankAccountPatch {
  label?: string;
  bankName?: string;
  accountNumber?: string | null;
  pixKey?: string | null;
  apiKey?: string | null;
  unverifiedPolicy?: 'HOLD' | 'ALLOCATE';
  active?: boolean;
}

/**
 * CRUD de cuentas bancarias del tenant (solo ADMIN en la frontera). El secreto `apiKey`
 * jamás sale del repositorio: la vista expone únicamente `hasApiKey`. Bajo RLS por tenant.
 */
@Injectable()
export class BankAccountDrizzleRepository {
  async list(tenantId: string): Promise<BankAccount[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.tenantBankAccount)
        .orderBy(desc(schema.tenantBankAccount.createdAt));
      return rows.map(toView);
    });
  }

  async create(
    tenantId: string,
    input: BankAccountInput,
  ): Promise<BankAccount> {
    return withTenantTxFor(tenantId, async (tx) => {
      try {
        const [row] = await tx
          .insert(schema.tenantBankAccount)
          .values({
            tenantId,
            label: input.label,
            bankName: input.bankName,
            accountNumber: input.accountNumber ?? null,
            countryCode: input.countryCode,
            bankCode: input.bankCode,
            pixKey: input.pixKey ?? null,
            apiKey: input.apiKey ?? null,
            ...(input.unverifiedPolicy
              ? { unverifiedPolicy: input.unverifiedPolicy }
              : {}),
          })
          .returning();
        return toView(row);
      } catch (err) {
        throw translateUnique(err);
      }
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: BankAccountPatch,
  ): Promise<BankAccount> {
    return withTenantTxFor(tenantId, async (tx) => {
      try {
        const [row] = await tx
          .update(schema.tenantBankAccount)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(schema.tenantBankAccount.id, id))
          .returning();
        if (!row) throw new NotFoundException('Cuenta bancaria no encontrada');
        return toView(row);
      } catch (err) {
        throw translateUnique(err);
      }
    });
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    return withTenantTxFor(tenantId, async (tx) => {
      await assertNoLinkedBox(tx, id);
      const [row] = await tx
        .delete(schema.tenantBankAccount)
        .where(eq(schema.tenantBankAccount.id, id))
        .returning({ id: schema.tenantBankAccount.id });
      if (!row) throw new NotFoundException('Cuenta bancaria no encontrada');
      return { id: row.id };
    });
  }
}

async function assertNoLinkedBox(tx: Tx, bankAccountId: string): Promise<void> {
  const [linked] = await tx
    .select({ id: schema.cashBox.id })
    .from(schema.cashBox)
    .where(and(eq(schema.cashBox.bankAccountId, bankAccountId)))
    .limit(1);
  if (linked) {
    throw new ConflictException(
      'No se puede eliminar: la cuenta tiene una caja bancaria vinculada',
    );
  }
}

function toView(row: Row): BankAccount {
  return {
    id: row.id,
    label: row.label,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    countryCode: row.countryCode,
    bankCode: row.bankCode,
    pixKey: row.pixKey,
    hasApiKey: row.apiKey !== null,
    unverifiedPolicy: row.unverifiedPolicy,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Una violación de unicidad (cuenta duplicada por país/banco o llave PIX) → 409. */
function translateUnique(err: unknown): unknown {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  ) {
    return new ConflictException(
      'Ya existe una cuenta con ese país/banco o llave PIX',
    );
  }
  return err;
}
