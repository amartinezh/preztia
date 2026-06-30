import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../../../tenancy/unit-of-work';
import { decryptOptionalSecret } from '../../../shared/secret-cipher';
import { CREDENTIAL_NAME } from '../../../cash/bank-credential.names';

/** Datos de la cuenta MP necesarios para procesar su webhook de reporte. */
export interface MercadoPagoWebhookContext {
  readonly bankAccountId: string;
  readonly countryCode: string;
  readonly bankCode: string;
  /** Secreto del webhook (descifrado) para validar la firma. */
  readonly webhookSecret: string;
  /** Ventana de conciliación en días (de reportConfig); null = usar el default. */
  readonly windowDays: number | null;
}

/** Puerto interno: contexto del webhook MP del tenant — mockeable en tests. */
export interface MercadoPagoWebhookContextReader {
  read(tenantId: string): Promise<MercadoPagoWebhookContext | null>;
}

/**
 * Resuelve la cuenta MERCADOPAGO activa del tenant y descifra su secreto de webhook. Devuelve
 * `null` si no hay cuenta MP o no tiene secreto configurado (sin secreto no se puede validar la
 * firma → el webhook se rechaza). Todo bajo RLS; el secreto nunca sale de aquí.
 */
@Injectable()
export class MercadoPagoWebhookContextDrizzleReader implements MercadoPagoWebhookContextReader {
  async read(tenantId: string): Promise<MercadoPagoWebhookContext | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [account] = await tx
        .select({
          id: schema.tenantBankAccount.id,
          countryCode: schema.tenantBankAccount.countryCode,
          bankCode: schema.tenantBankAccount.bankCode,
          reportConfig: schema.tenantBankAccount.reportConfig,
        })
        .from(schema.tenantBankAccount)
        .where(
          and(
            eq(schema.tenantBankAccount.providerType, 'MERCADOPAGO'),
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

      const webhookSecret = decryptOptionalSecret(credential?.value ?? null);
      if (!webhookSecret) return null;

      return {
        bankAccountId: account.id,
        countryCode: account.countryCode,
        bankCode: account.bankCode,
        webhookSecret,
        windowDays: account.reportConfig?.windowDays ?? null,
      };
    });
  }
}
