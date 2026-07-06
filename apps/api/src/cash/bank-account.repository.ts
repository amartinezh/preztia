import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  BankAccount,
  BankAccountInput,
  BankProviderType,
  BankReportConfig,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { encryptOptionalSecret } from '../shared/secret-cipher';
import { BankCredentialDrizzleRepository } from './bank-credential.repository';
import { CREDENTIAL_NAME } from './bank-credential.names';

type Row = typeof schema.tenantBankAccount.$inferSelect;

/** Patch parcial de una cuenta. `null` en campos opcionales borra el valor. */
export interface BankAccountPatch {
  label?: string;
  bankName?: string;
  accountNumber?: string | null;
  providerType?: BankProviderType;
  pixKey?: string | null;
  receiverTaxId?: string | null;
  receiverName?: string | null;
  apiKey?: string | null;
  reportConfig?: BankReportConfig | null;
  // Secretos del proveedor (ej. Mercado Pago, PicPay): viven cifrados en `bank_credential`.
  // string = setear; null = borrar; ausente = no tocar.
  publicKey?: string | null;
  accessToken?: string | null;
  webhookSecret?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  unverifiedPolicy?: 'HOLD' | 'ALLOCATE';
  verifyPaymentsEnabled?: boolean;
  balanceCheckEnabled?: boolean;
  active?: boolean;
}

/**
 * CRUD de la CONFIGURACIÓN de cuentas bancarias/proveedores del tenant (solo ADMIN en la
 * frontera). La cuenta y sus secretos (`bank_credential`) forman un agregado: se escriben en
 * UNA transacción. Los secretos jamás salen: la vista solo expone su PRESENCIA (`hasX`). RLS.
 */
@Injectable()
export class BankAccountDrizzleRepository {
  constructor(private readonly credentials: BankCredentialDrizzleRepository) {}

  async list(tenantId: string): Promise<BankAccount[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.tenantBankAccount)
        .orderBy(desc(schema.tenantBankAccount.createdAt));
      const namesByAccount = await this.credentials.namesByAccountTx(tx);
      return rows.map((row) => toView(row, namesByAccount.get(row.id) ?? []));
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
            receiverTaxId: input.receiverTaxId ?? null,
            receiverName: input.receiverName ?? null,
            // Credencial bancaria cifrada en reposo (AES-256-GCM); nunca en claro.
            apiKey: encryptOptionalSecret(input.apiKey),
            reportConfig: input.reportConfig ?? null,
            // providerType: si no viene, la BD aplica el default 'MANUAL'.
            ...(input.providerType ? { providerType: input.providerType } : {}),
            ...(input.unverifiedPolicy
              ? { unverifiedPolicy: input.unverifiedPolicy }
              : {}),
            // Toggles de validación: si no vienen, la BD aplica el default (habilitados).
            ...(input.verifyPaymentsEnabled !== undefined
              ? { verifyPaymentsEnabled: input.verifyPaymentsEnabled }
              : {}),
            ...(input.balanceCheckEnabled !== undefined
              ? { balanceCheckEnabled: input.balanceCheckEnabled }
              : {}),
          })
          .returning();
        // Secretos del proveedor en la misma transacción (agregado atómico).
        await this.credentials.setManyTx(tx, tenantId, row.id, {
          [CREDENTIAL_NAME.publicKey]: input.publicKey,
          [CREDENTIAL_NAME.accessToken]: input.accessToken,
          [CREDENTIAL_NAME.webhookSecret]: input.webhookSecret,
          [CREDENTIAL_NAME.clientId]: input.clientId,
          [CREDENTIAL_NAME.clientSecret]: input.clientSecret,
        });
        const names = await this.credentials.listNamesTx(tx, row.id);
        return toView(row, names);
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
        // Los secretos NO son columnas de la cuenta: se separan del set de la fila.
        const {
          publicKey,
          accessToken,
          webhookSecret,
          clientId,
          clientSecret,
          ...accountPatch
        } = patch;
        const set = {
          ...accountPatch,
          // Cifra la credencial si el parche la toca (`apiKey: null` la borra).
          ...('apiKey' in accountPatch
            ? { apiKey: encryptOptionalSecret(accountPatch.apiKey) }
            : {}),
          updatedAt: new Date(),
        };
        const [row] = await tx
          .update(schema.tenantBankAccount)
          .set(set)
          .where(eq(schema.tenantBankAccount.id, id))
          .returning();
        if (!row) throw new NotFoundException('Cuenta bancaria no encontrada');
        await this.credentials.setManyTx(tx, tenantId, id, {
          [CREDENTIAL_NAME.publicKey]: publicKey,
          [CREDENTIAL_NAME.accessToken]: accessToken,
          [CREDENTIAL_NAME.webhookSecret]: webhookSecret,
          [CREDENTIAL_NAME.clientId]: clientId,
          [CREDENTIAL_NAME.clientSecret]: clientSecret,
        });
        const names = await this.credentials.listNamesTx(tx, id);
        return toView(row, names);
      } catch (err) {
        throw translateUnique(err);
      }
    });
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    return withTenantTxFor(tenantId, async (tx) => {
      await assertNoLinkedBox(tx, id);
      // Los secretos se borran en cascada (FK ON DELETE CASCADE de bank_credential).
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

function toView(row: Row, credentialNames: readonly string[]): BankAccount {
  return {
    id: row.id,
    label: row.label,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    countryCode: row.countryCode,
    bankCode: row.bankCode,
    providerType: row.providerType,
    pixKey: row.pixKey,
    receiverTaxId: row.receiverTaxId,
    receiverName: row.receiverName,
    hasApiKey: row.apiKey !== null,
    hasPublicKey: credentialNames.includes(CREDENTIAL_NAME.publicKey),
    hasAccessToken: credentialNames.includes(CREDENTIAL_NAME.accessToken),
    hasWebhookSecret: credentialNames.includes(CREDENTIAL_NAME.webhookSecret),
    hasClientId: credentialNames.includes(CREDENTIAL_NAME.clientId),
    hasClientSecret: credentialNames.includes(CREDENTIAL_NAME.clientSecret),
    reportConfig: row.reportConfig ?? null,
    unverifiedPolicy: row.unverifiedPolicy,
    verifyPaymentsEnabled: row.verifyPaymentsEnabled,
    balanceCheckEnabled: row.balanceCheckEnabled,
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
