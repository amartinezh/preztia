import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type BankBalanceProvider } from '@preztiaos/application';
import { reconcileBalance, type BankBalanceVerdict } from '@preztiaos/domain';
import type { BankSyncResultView } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { balanceOfBox } from './cash-ledger';
import { decryptOptionalSecret } from '../shared/secret-cipher';
import { BANK_BALANCE_PROVIDER } from './cash.tokens';

interface SyncContext {
  countryCode: string;
  bankCode: string;
  apiKey: string | null;
  systemMinor: number;
}

/**
 * Conciliación bancaria en línea (Req 7, botón "Sincronizar Saldo"): trae el saldo REAL del
 * banco por API, lo compara con el saldo del sistema (Σ asientos) vía la regla pura
 * `reconcileBalance` y deja una foto append-only. La llamada HTTP al banco ocurre FUERA de la
 * transacción (no se sostiene una tx abierta durante I/O externa).
 */
@Injectable()
export class BankReconciliationDrizzleRepository {
  constructor(
    @Inject(BANK_BALANCE_PROVIDER)
    private readonly bank: BankBalanceProvider,
  ) {}

  async sync(input: {
    tenantId: string;
    cashBoxId: string;
    syncedBy: string;
  }): Promise<BankSyncResultView> {
    const ctx = await this.loadContext(input.tenantId, input.cashBoxId);

    const verdict = await this.bank.fetchBalance({
      tenantId: input.tenantId,
      countryCode: ctx.countryCode,
      bankCode: ctx.bankCode,
      apiKey: ctx.apiKey,
    });

    const result = reconcileBalance(ctx.systemMinor, verdict);
    return this.persist(input, ctx.systemMinor, result, verdict);
  }

  /** Valida que la caja es bancaria, resuelve su cuenta y mide el saldo del sistema. */
  private async loadContext(
    tenantId: string,
    cashBoxId: string,
  ): Promise<SyncContext> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [box] = await tx
        .select({
          type: schema.cashBox.type,
          bankAccountId: schema.cashBox.bankAccountId,
        })
        .from(schema.cashBox)
        .where(eq(schema.cashBox.id, cashBoxId))
        .limit(1);
      if (!box) throw new NotFoundException('Caja no encontrada');
      if (box.type !== 'BANK' || !box.bankAccountId) {
        throw new BadRequestException(
          'Solo las cajas bancarias se pueden sincronizar con el banco',
        );
      }

      const [account] = await tx
        .select({
          countryCode: schema.tenantBankAccount.countryCode,
          bankCode: schema.tenantBankAccount.bankCode,
          apiKey: schema.tenantBankAccount.apiKey,
        })
        .from(schema.tenantBankAccount)
        .where(eq(schema.tenantBankAccount.id, box.bankAccountId))
        .limit(1);
      if (!account)
        throw new NotFoundException('Cuenta bancaria no encontrada');

      const systemMinor = await balanceOfBox(tx, cashBoxId);
      // La credencial está cifrada en reposo: se descifra justo para consultar el banco.
      return {
        ...account,
        apiKey: decryptOptionalSecret(account.apiKey),
        systemMinor,
      };
    });
  }

  private async persist(
    input: { tenantId: string; cashBoxId: string; syncedBy: string },
    systemMinor: number,
    result: ReturnType<typeof reconcileBalance>,
    verdict: BankBalanceVerdict,
  ): Promise<BankSyncResultView> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.bankReconciliation)
        .values({
          tenantId: input.tenantId,
          cashBoxId: input.cashBoxId,
          systemMinor,
          bankMinor: result.bankMinor,
          differenceMinor: result.differenceMinor,
          status: result.status,
          rawResponse: verdict,
          syncedBy: input.syncedBy,
        })
        .returning();
      return {
        id: row.id,
        cashBoxId: row.cashBoxId,
        status: row.status,
        systemMinor: row.systemMinor,
        bankMinor: row.bankMinor,
        differenceMinor: row.differenceMinor,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
