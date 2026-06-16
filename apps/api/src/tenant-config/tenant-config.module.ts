import { Module } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigRepository } from './tenant-config.repository';
import { AssistantConfigRepository } from './assistant-config.repository';
import { DocumentRequirementsRepository } from './document-requirements.repository';

/**
 * Módulo de CONFIGURACIÓN DE COBRO del tenant (ajustes operativos) y del ASISTENTE de WhatsApp
 * (base de conocimiento + IA). Plano de datos bajo el rol `app` + RLS y `JwtGuard`. Exporta el
 * repo operativo para que el alta de clientes aplique el cupo por defecto.
 */
@Module({
  controllers: [TenantConfigController],
  providers: [
    TenantConfigRepository,
    AssistantConfigRepository,
    DocumentRequirementsRepository,
  ],
  exports: [TenantConfigRepository],
})
export class TenantConfigModule {}
