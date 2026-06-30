import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type BankReportConfig } from '@preztiaos/contracts';
import { withTenantTxFor } from '../../../tenancy/unit-of-work';
import { decryptOptionalSecret } from '../../../shared/secret-cipher';
import { CREDENTIAL_NAME } from '../../../cash/bank-credential.names';

/** Lo que el adaptador de liquidación necesita de la cuenta MP del tenant (sin exponer más). */
export interface MercadoPagoContext {
  readonly accessToken: string;
  readonly reportConfig: BankReportConfig | null;
}

/** Puerto interno: resuelve el contexto MP por (país, banco) — mockeable en tests. */
export interface MercadoPagoContextReader {
  read(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
  }): Promise<MercadoPagoContext | null>;
}

/**
 * Lee la cuenta recaudadora activa por (país, banco) y descifra su access_token desde
 * `bank_credential`. Devuelve `null` si no hay cuenta o no hay token (la conciliación queda
 * sin confirmar, nunca rompe). Todo bajo RLS por tenant; el secreto nunca sale de aquí.
 */
@Injectable()
export class MercadoPagoContextDrizzleReader implements MercadoPagoContextReader {
  async read(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
  }): Promise<MercadoPagoContext | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [account] = await tx
        .select({
          id: schema.tenantBankAccount.id,
          reportConfig: schema.tenantBankAccount.reportConfig,
        })
        .from(schema.tenantBankAccount)
        .where(
          and(
            eq(schema.tenantBankAccount.countryCode, input.countryCode),
            eq(schema.tenantBankAccount.bankCode, input.bankCode),
            eq(schema.tenantBankAccount.active, true),
          ),
        )
        .limit(1);
      if (!account) return null;

      const [credential] = await tx
        .select({ value: schema.bankCredential.valueEncrypted })
        .from(schema.bankCredential)
        .where(
          and(
            eq(schema.bankCredential.bankAccountId, account.id),
            eq(schema.bankCredential.name, CREDENTIAL_NAME.accessToken),
          ),
        )
        .limit(1);

      const accessToken = decryptOptionalSecret(credential?.value ?? null);
      if (!accessToken) return null;
      return { accessToken, reportConfig: account.reportConfig ?? null };
    });
  }
}
