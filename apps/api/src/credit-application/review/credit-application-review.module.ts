import { Module } from '@nestjs/common';
import { ApplicationReviewController } from './application-review.controller';
import { ApplicationReviewQueryRepository } from './application-review-query.repository';
import { ApplicationDecisionRepository } from './application-decision.repository';
import { DocumentOriginalStorage } from './document-original.storage';

/**
 * Módulo de la revisión antifraude de cartera: expone los endpoints que consume el
 * funcionario/coordinador (listar intentos, ver detalle e historial, abrir el documento
 * original, leer la conversación, aprobar/rechazar el expediente).
 */
@Module({
  controllers: [ApplicationReviewController],
  providers: [
    ApplicationReviewQueryRepository,
    ApplicationDecisionRepository,
    DocumentOriginalStorage,
  ],
})
export class CreditApplicationReviewModule {}
