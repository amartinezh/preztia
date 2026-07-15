import { Module } from '@nestjs/common';
import {
  type CepLookup,
  type CnpjRegistryLookup,
  type CpfRegistryVerifier,
  type DddLookup,
  type DocumentExtractionReader,
  ValidateApplicationDocumentsHandler,
  type ValidationReportRepository,
} from '@preztiaos/application';
import { ApplicationReviewController } from './application-review.controller';
import { ApplicationReviewQueryRepository } from './application-review-query.repository';
import { ApplicationDecisionRepository } from './application-decision.repository';
import { DocumentOriginalStorage } from './document-original.storage';
import { PlanOfferRepository } from './plan-offer.repository';
import { PlanOfferWhatsappNotifier } from './plan-offer.notifier';
import { CreditRegisteredWhatsappNotifier } from './credit-registered.notifier';
import { ReExtractDocumentService } from './re-extract-document.service';
import { AiDocumentReviewer } from '../document-reviewer';
import { GeminiBusinessPhotoAnalyzer } from '../ai/gemini-business-photo.analyzer';
import { RequiredDocumentCatalogDrizzleRepository } from '../required-document-catalog.repository';
import { DrizzleDocumentExtractionReader } from '../validation/document-extraction.reader';
import { DrizzleValidationReportRepository } from '../validation/validation-report.repository';
import { MinhaReceitaCnpjRegistry } from '../validation/minha-receita.client';
import { BrasilApiCepLookup } from '../validation/brasilapi-cep.client';
import { BrasilApiDddLookup } from '../validation/brasilapi-ddd.client';
import { SerproCpfVerifier } from '../validation/serpro-cpf.client';
import { PaymentPlanModule } from '../../credit/plans/payment-plan.module';
import { TenantConfigModule } from '../../tenant-config/tenant-config.module';

/**
 * Módulo de la revisión antifraude de cartera: expone los endpoints que consume el
 * funcionario/coordinador (listar intentos, ver detalle e historial, abrir el documento
 * original, leer la conversación, ofertar planes por WhatsApp y aprobar/rechazar el expediente).
 * Reusa los planes de pago (PaymentPlanModule) y la configuración del tenant (TenantConfigModule)
 * para resolver, al ofertar, el toggle de autonomía + el plan por defecto / planes activos.
 *
 * Además cablea la NUEVA PASADA DE IA manual sobre un documento (`ReExtractDocumentService`):
 * reusa el reviewer de IA, el catálogo de documentos y el pipeline de validación antifraude.
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
    CreditRegisteredWhatsappNotifier,

    // Re-extracción de IA pedida por el revisor + su pipeline de validación.
    AiDocumentReviewer,
    GeminiBusinessPhotoAnalyzer,
    RequiredDocumentCatalogDrizzleRepository,
    {
      provide: ValidateApplicationDocumentsHandler,
      inject: [
        DrizzleDocumentExtractionReader,
        MinhaReceitaCnpjRegistry,
        BrasilApiCepLookup,
        BrasilApiDddLookup,
        SerproCpfVerifier,
        DrizzleValidationReportRepository,
      ],
      useFactory: (
        extractions: DocumentExtractionReader,
        cnpjRegistry: CnpjRegistryLookup,
        ceps: CepLookup,
        ddds: DddLookup,
        cpfRegistry: CpfRegistryVerifier,
        reports: ValidationReportRepository,
      ) =>
        new ValidateApplicationDocumentsHandler(
          extractions,
          cnpjRegistry,
          ceps,
          ddds,
          cpfRegistry,
          reports,
        ),
    },
    DrizzleDocumentExtractionReader,
    DrizzleValidationReportRepository,
    MinhaReceitaCnpjRegistry,
    BrasilApiCepLookup,
    BrasilApiDddLookup,
    SerproCpfVerifier,
    ReExtractDocumentService,
  ],
})
export class CreditApplicationReviewModule {}
