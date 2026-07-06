import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../../../tenancy/unit-of-work';
import { decryptOptionalSecret } from '../../../shared/secret-cipher';
import { CREDENTIAL_NAME } from '../../../cash/bank-credential.names';

/** Datos de la cuenta PicPay necesarios para procesar su webhook. */
export interface PicPayWebhookContext {
  readonly bankAccountId: string;
  /** Token de notificación del Painel Lojista (descifrado) para autenticar el webhook. */
  readonly webhookToken: string;
}

/** Puerto interno: contexto del webhook PicPay del tenant — mockeable en tests. */
export interface PicPayWebhookContextReader {
  read(tenantId: string): Promise<PicPayWebhookContext | null>;
}

/**
 * Resuelve la cuenta PICPAY activa del tenant y descifra su token de webhook. Devuelve `null`
 * si no hay cuenta PicPay o no tiene token configurado (sin token no se puede autenticar la
 * notificación → se rechaza). Todo bajo RLS; el token nunca sale de aquí.
 */
@Injectable()
export class PicPayWebhookContextDrizzleReader implements PicPayWebhookContextReader {
  async read(tenantId: string): Promise<PicPayWebhookContext | null> {
    return withTenantTxFor(tenantId, async (tx) => {
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

      const [credential] = await tx
        .select({ value: schema.bankCredential.valueEncrypted })
        .from(schema.bankCredential)
        .where(
          and(
            eq(schema.bankCredential.bankAccountId, account.id),
            eq(schema.bankCredential.name, CREDENTIAL_NAME.webhookSecret),
          ),
        )
        .limit(1);

      const webhookToken = decryptOptionalSecret(credential?.value ?? null);
      if (!webhookToken) return null;

      return { bankAccountId: account.id, webhookToken };
    });
  }
}
