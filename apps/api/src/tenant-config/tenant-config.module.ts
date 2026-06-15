import { Module } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigRepository } from './tenant-config.repository';

/**
 * Módulo de CONFIGURACIÓN DE COBRO del tenant (ajustes operativos). Plano de datos bajo el rol
 * `app` + RLS y `JwtGuard`. Exporta el repo para que el alta de clientes aplique el cupo por
 * defecto.
 */
@Module({
  controllers: [TenantConfigController],
  providers: [TenantConfigRepository],
  exports: [TenantConfigRepository],
})
export class TenantConfigModule {}
