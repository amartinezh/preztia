import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { BankCredentialDrizzleRepository } from './bank-credential.repository';
import { CREDENTIAL_NAME } from './bank-credential.names';
import { MercadoPagoAccountClient } from './banking/mercadopago/mp-account.client';
import { PicPayAuthClient } from './banking/picpay/picpay-auth.client';

/** Veredicto de probar las credenciales de un proveedor; sin secretos. */
export interface CredentialVerification {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Caso de uso "Probar credenciales": resuelve el proveedor de la cuenta y delega la prueba al
 * cliente del proveedor. Lee el secreto solo para usarlo en la llamada saliente; jamás lo
 * devuelve. Soporta Mercado Pago (GET /users/me) y PicPay (token OAuth2 client_credentials);
 * otros proveedores degradan a no soportado.
 */
@Injectable()
export class BankProviderVerifierService {
  constructor(
    private readonly credentials: BankCredentialDrizzleRepository,
    private readonly mercadoPago: MercadoPagoAccountClient,
    private readonly picPay: PicPayAuthClient,
  ) {}

  async verify(
    tenantId: string,
    bankAccountId: string,
  ): Promise<CredentialVerification> {
    const providerType = await this.loadProviderType(tenantId, bankAccountId);
    if (!providerType) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }
    if (providerType === 'MERCADOPAGO') {
      return this.verifyMercadoPago(tenantId, bankAccountId);
    }
    if (providerType === 'PICPAY') {
      return this.verifyPicPay(tenantId, bankAccountId);
    }
    return {
      ok: false,
      detail:
        'La prueba de credenciales solo está disponible para Mercado Pago y PicPay',
    };
  }

  private async verifyMercadoPago(
    tenantId: string,
    bankAccountId: string,
  ): Promise<CredentialVerification> {
    const accessToken = await this.credentials.get({
      tenantId,
      bankAccountId,
      name: CREDENTIAL_NAME.accessToken,
    });
    if (!accessToken) return { ok: false, detail: 'Falta el access_token' };
    return this.mercadoPago.verifyAccessToken(accessToken);
  }

  private async verifyPicPay(
    tenantId: string,
    bankAccountId: string,
  ): Promise<CredentialVerification> {
    const clientId = await this.credentials.get({
      tenantId,
      bankAccountId,
      name: CREDENTIAL_NAME.clientId,
    });
    const clientSecret = await this.credentials.get({
      tenantId,
      bankAccountId,
      name: CREDENTIAL_NAME.clientSecret,
    });
    if (!clientId || !clientSecret) {
      return { ok: false, detail: 'Faltan el client_id o el client_secret' };
    }
    return this.picPay.verifyClientCredentials({ clientId, clientSecret });
  }

  private async loadProviderType(
    tenantId: string,
    bankAccountId: string,
  ): Promise<string | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ providerType: schema.tenantBankAccount.providerType })
        .from(schema.tenantBankAccount)
        .where(eq(schema.tenantBankAccount.id, bankAccountId))
        .limit(1);
      return row?.providerType ?? null;
    });
  }
}
