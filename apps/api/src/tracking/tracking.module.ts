import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { LocationDrizzleRepository } from './location.repository';
import { TrackingQueryRepository } from './tracking-query.repository';

/**
 * Módulo de TRACKING: registro de posición del cobrador (recorrido) y read-models de recorrido,
 * último registro y posición de clientes. Plano de datos bajo el rol `app` + RLS y `JwtGuard`.
 */
@Module({
  controllers: [TrackingController],
  providers: [LocationDrizzleRepository, TrackingQueryRepository],
})
export class TrackingModule {}
