import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type ActiveTenantBankAccount,
  type TenantBankAccountRepository,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/** Adaptador del puerto TenantBankAccountRepository (lectura bajo RLS). */
@Injectable()
export class TenantBankAccountDrizzleRepository implements TenantBankAccountRepository {
  async findActive(tenantId: string): Promise<ActiveTenantBankAccount | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          countryCode: schema.tenantBankAccount.countryCode,
          bankCode: schema.tenantBankAccount.bankCode,
          unverifiedPolicy: schema.tenantBankAccount.unverifiedPolicy,
        })
        .from(schema.tenantBankAccount)
        .where(eq(schema.tenantBankAccount.active, true))
        .limit(1);
      return row ?? null;
    });
  }

  /** Credencial del banco del tenant; la usan los adaptadores bancarios. */
  async findApiKey(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
  }): Promise<string | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ apiKey: schema.tenantBankAccount.apiKey })
        .from(schema.tenantBankAccount)
        .where(
          and(
            eq(schema.tenantBankAccount.countryCode, input.countryCode),
            eq(schema.tenantBankAccount.bankCode, input.bankCode),
            eq(schema.tenantBankAccount.active, true),
          ),
        );
      return row?.apiKey ?? null;
    });
  }
}
