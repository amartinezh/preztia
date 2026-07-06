import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type ActiveTenantBankAccount,
  type TenantBankAccountRepository,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { decryptOptionalSecret } from '../shared/secret-cipher';

// Prioridad de VERIFICACIÓN entre proveedores: PicPay primero (medio principal: su webhook
// trae endToEndId y confirma en línea), luego Inter (consulta per-PIX) y el resto. Un proveedor
// no listado va al final.
const VERIFICATION_PRIORITY: Readonly<Record<string, number>> = {
  PICPAY: 0,
  INTER: 1,
  MERCADOPAGO: 2,
  MANUAL: 3,
};

function verificationPriority(providerType: string): number {
  return VERIFICATION_PRIORITY[providerType] ?? Number.MAX_SAFE_INTEGER;
}

/** Adaptador del puerto TenantBankAccountRepository (lectura bajo RLS). */
@Injectable()
export class TenantBankAccountDrizzleRepository implements TenantBankAccountRepository {
  /** Cuentas activas con la validación de pagos habilitada, en orden de prioridad. */
  async listForVerification(
    tenantId: string,
  ): Promise<ActiveTenantBankAccount[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select({
          countryCode: schema.tenantBankAccount.countryCode,
          bankCode: schema.tenantBankAccount.bankCode,
          unverifiedPolicy: schema.tenantBankAccount.unverifiedPolicy,
          providerType: schema.tenantBankAccount.providerType,
        })
        .from(schema.tenantBankAccount)
        .where(
          and(
            eq(schema.tenantBankAccount.active, true),
            eq(schema.tenantBankAccount.verifyPaymentsEnabled, true),
          ),
        );
      return rows
        .sort(
          (a, b) =>
            verificationPriority(a.providerType) -
            verificationPriority(b.providerType),
        )
        .map((row) => ({
          countryCode: row.countryCode,
          bankCode: row.bankCode,
          unverifiedPolicy: row.unverifiedPolicy,
        }));
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
      // Cifrada en reposo: se descifra para que el adaptador bancario consulte.
      return decryptOptionalSecret(row?.apiKey);
    });
  }
}
