import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashBoxController } from './cash-box.controller';
import { BankAccountController } from './bank-account.controller';
import { ExpenseDrizzleRepository } from './expense.repository';
import { SettlementDrizzleRepository } from './settlement.repository';
import { CashQueryRepository } from './cash-query.repository';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { BankAccountDrizzleRepository } from './bank-account.repository';
import { CashCountDrizzleRepository } from './cash-count.repository';
import { BankReconciliationDrizzleRepository } from './bank-reconciliation.repository';
import { BankBalanceProviderRegistry } from './banking/bank-balance.registry';
import { InterBalanceClient } from './banking/inter/inter-balance.client';
import { InterBalanceProvider } from './banking/inter/inter-balance.provider';
import { BANK_BALANCE_PROVIDER } from './cash.tokens';

/**
 * Módulo de CAJA: gastos (maker-checker), liquidadas (cierre de caja encadenado), reporte
 * diario, y el manejo de cajas/cuentas bancarias (clasificación, libro mayor, transferencias,
 * dashboard, arqueo y conciliación bancaria en línea). Plano de datos bajo `app` + RLS y JwtGuard.
 */
@Module({
  controllers: [CashController, CashBoxController, BankAccountController],
  providers: [
    ExpenseDrizzleRepository,
    SettlementDrizzleRepository,
    CashQueryRepository,
    CashBoxDrizzleRepository,
    BankAccountDrizzleRepository,
    CashCountDrizzleRepository,
    BankReconciliationDrizzleRepository,

    // Conciliación bancaria por (país, entidad). PUNTO DE EXTENSIÓN: para conciliar un banco
    // nuevo se registra su adaptador con la clave "PAÍS:BANCO" (igual que BANK_PAYMENT_VERIFIER).
    InterBalanceClient,
    InterBalanceProvider,
    {
      provide: BANK_BALANCE_PROVIDER,
      inject: [InterBalanceProvider],
      useFactory: (inter: InterBalanceProvider) =>
        new BankBalanceProviderRegistry(new Map([['BR:INTER', inter]])),
    },
  ],
})
export class CashModule {}
