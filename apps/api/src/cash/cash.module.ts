import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { ExpenseDrizzleRepository } from './expense.repository';
import { SettlementDrizzleRepository } from './settlement.repository';
import { CashQueryRepository } from './cash-query.repository';

/**
 * Módulo de CAJA: gastos (maker-checker), liquidadas (cierre de caja encadenado) y reporte
 * diario. Plano de datos bajo el rol `app` + RLS y `JwtGuard`.
 */
@Module({
  controllers: [CashController],
  providers: [
    ExpenseDrizzleRepository,
    SettlementDrizzleRepository,
    CashQueryRepository,
  ],
})
export class CashModule {}
