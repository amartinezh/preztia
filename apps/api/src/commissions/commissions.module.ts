import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionSettingsRepository } from './commission-settings.repository';
import { CommissionPaymentRepository } from './commission-payment.repository';

/**
 * Módulo de COMISIONES del cobrador: configuración por zona con herencia y tope del ADMIN, y pago
 * de la comisión causada en la liquidación como asiento COMMISSION del libro de cajas.
 */
@Module({
  controllers: [CommissionsController],
  providers: [CommissionSettingsRepository, CommissionPaymentRepository],
})
export class CommissionsModule {}
