import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { SettlementRepository } from './settlement.repository';
import { SettlementCron } from './settlement.cron';

/**
 * Módulo de LIQUIDACIÓN POR PERÍODOS: fotografías selladas del libro de cajas y de la cartera
 * (ADR #41), su lectura por alcance y el cierre automático por tenant.
 */
@Module({
  controllers: [SettlementController],
  providers: [SettlementRepository, SettlementCron],
})
export class SettlementsModule {}
