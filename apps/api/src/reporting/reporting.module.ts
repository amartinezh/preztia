import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { ReportingQueryRepository } from './reporting-query.repository';

/**
 * Módulo de REPORTERÍA (read-models / CQRS): panel del tenant, resumen de cliente y export CSV.
 * Solo lectura, bajo el rol `app` + RLS y `JwtGuard`.
 */
@Module({
  controllers: [ReportingController],
  providers: [ReportingQueryRepository],
})
export class ReportingModule {}
