import { Module } from '@nestjs/common';
import { ApplicationReviewController } from './application-review.controller';
import { ApplicationReviewQueryRepository } from './application-review-query.repository';
import { ApplicationDecisionRepository } from './application-decision.repository';
import { DocumentOriginalStorage } from './document-original.storage';
import { PlanOfferRepository } from './plan-offer.repository';
import { PlanOfferWhatsappNotifier } from './plan-offer.notifier';
import { PaymentPlanModule } from '../../credit/plans/payment-plan.module';
import { TenantConfigModule } from '../../tenant-config/tenant-config.module';

/**
 * Módulo de la revisión antifraude de cartera: expone los endpoints que consume el
 * funcionario/coordinador (listar intentos, ver detalle e historial, abrir el documento
 * original, leer la conversación, ofertar planes por WhatsApp y aprobar/rechazar el expediente).
 * Reusa los planes de pago (PaymentPlanModule) y la configuración del tenant (TenantConfigModule)
 * para resolver, al ofertar, el toggle de autonomía + el plan por defecto / planes activos.
 */
@Module({
  imports: [PaymentPlanModule, TenantConfigModule],
  controllers: [ApplicationReviewController],
  providers: [
    ApplicationReviewQueryRepository,
    ApplicationDecisionRepository,
    DocumentOriginalStorage,
    PlanOfferRepository,
    PlanOfferWhatsappNotifier,
  ],
})
export class CreditApplicationReviewModule {}
