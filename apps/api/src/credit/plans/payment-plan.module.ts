import { Module } from '@nestjs/common';
import { PaymentPlanController } from './payment-plan.controller';
import { PaymentPlanRepository } from './payment-plan.repository';

/**
 * Módulo de PLANES DE PAGO del tenant (plantillas de crédito ofertables). Plano de datos bajo el
 * rol `app` + RLS y `JwtGuard`. Exporta el repo para que el flujo de oferta (Fase 10) lea los
 * planes activos y el plan por defecto al ofertar por WhatsApp.
 */
@Module({
  controllers: [PaymentPlanController],
  providers: [PaymentPlanRepository],
  exports: [PaymentPlanRepository],
})
export class PaymentPlanModule {}
