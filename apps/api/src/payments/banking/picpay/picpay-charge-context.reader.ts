import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../../../tenancy/unit-of-work';
import { decryptOptionalSecret } from '../../../shared/secret-cipher';
import { CREDENTIAL_NAME } from '../../../cash/bank-credential.names';

/** Datos del pagador para la cobrança (KYC que exige PicPay). Sin PII en logs. */
export interface PicPayCustomer {
  readonly name: string;
  readonly document: string;
}

/** Contexto para generar una cobrança PicPay de un crédito: credenciales OAuth + cliente. */
export interface PicPayChargeContext {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly customer: PicPayCustomer;
}

/**
 * Resuelve la cuenta PICPAY activa del tenant (con sus credenciales OAuth descifradas) y los datos
 * del pagador (borrower del crédito) para armar la cobrança. Devuelve `null` si falta la cuenta o
 * las credenciales. Todo bajo RLS; los secretos nunca salen de aquí.
 */
@Injectable()
export class PicPayChargeContextReader {
  async read(input: {
    tenantId: string;
    creditId: string;
  }): Promise<PicPayChargeContext | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [account] = await tx
        .select({ id: schema.tenantBankAccount.id })
        .from(schema.tenantBankAccount)
        .where(
          and(
            eq(schema.tenantBankAccount.providerType, 'PICPAY'),
            eq(schema.tenantBankAccount.active, true),
          ),
        )
        .limit(1);
      if (!account) return null;

      const credentials = await tx
        .select({
          name: schema.bankCredential.name,
          value: schema.bankCredential.valueEncrypted,
        })
        .from(schema.bankCredential)
        .where(eq(schema.bankCredential.bankAccountId, account.id));
      const byName = new Map(credentials.map((c) => [c.name, c.value]));
      const clientId = decryptOptionalSecret(
        byName.get(CREDENTIAL_NAME.clientId) ?? null,
      );
      const clientSecret = decryptOptionalSecret(
        byName.get(CREDENTIAL_NAME.clientSecret) ?? null,
      );
      if (!clientId || !clientSecret) return null;

      const [borrower] = await tx
        .select({
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          nationalId: schema.borrower.nationalId,
        })
        .from(schema.borrower)
        .innerJoin(
          schema.credit,
          eq(schema.credit.borrowerId, schema.borrower.id),
        )
        .where(eq(schema.credit.id, input.creditId))
        .limit(1);
      if (!borrower) return null;

      return {
        clientId,
        clientSecret,
        customer: {
          name: `${borrower.firstName} ${borrower.lastName}`.trim(),
          document: borrower.nationalId.replace(/\D/g, ''),
        },
      };
    });
  }
}
