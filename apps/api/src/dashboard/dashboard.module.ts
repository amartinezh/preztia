import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardQueryRepository } from './dashboard-query.repository';

/**
 * Módulo del DASHBOARD INICIAL (read-models / CQRS): KPIs financieros, de conversión de
 * solicitudes y de riesgo/fraude en un solo endpoint. Solo lectura, bajo el rol `app` + RLS
 * y `JwtGuard`.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardQueryRepository],
})
export class DashboardModule {}
