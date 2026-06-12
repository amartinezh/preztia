import { Module } from '@nestjs/common';
import {
  AnswerTextMessageHandler,
  type AntifraudService,
  type ApplicationCompletionNotifier,
  type AudioMessageDispatcher,
  type ConversationLog,
  type CreditApplicationRepository,
  type CreditApplicationRestarter,
  type CreditApplicationStarter,
  type CreditPortfolioRepository,
  type DocumentMessageDispatcher,
  type DocumentReviewer,
  type DocumentStorage,
  type ImageMessageDispatcher,
  type InboundMessageDeduplicator,
  type KnowledgeAssistant,
  type MediaClassifier,
  type MediaDownloader,
  type OutboundTextSender,
  type PendingDocumentReminder,
  ProcessInboundMessageHandler,
  type RequiredDocumentCatalog,
  RouteInboundMediaHandler,
  StartCreditApplicationHandler,
  SubmitApplicationDocumentHandler,
  SubmitPaymentReceiptHandler,
  type TenantAssistantConfigRepository,
  type TenantResolver,
  type TextMessageConsumer,
} from '@preztiaos/application';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappTextConsumer } from './adapters/whatsapp-text.consumer';
import { AudioDispatchAdapter } from './adapters/audio-dispatch.adapter';
import { TenantConfigDrizzleRepository } from './text/tenant-config.repository';
import { KnowledgeAssistantRouter } from './ai/knowledge-assistant.router';
import { WhatsappTextSender } from './text/whatsapp-text-sender';
import { LoggingTextSender } from './text/logging-text-sender';
import { ConversationMessageLog } from './conversation-message.log';
import { PaymentsModule } from '../payments/payments.module';
import { MediaRouterDispatcher } from '../payments/adapters/media-router.dispatcher';
import {
  CREDIT_PORTFOLIO_REPOSITORY,
  MEDIA_CLASSIFIER,
  MEDIA_ROUTER,
} from '../payments/payments.tokens';
import { CreditApplicationDrizzleRepository } from '../credit-application/credit-application.repository';
import { RequiredDocumentCatalogDrizzleRepository } from '../credit-application/required-document-catalog.repository';
import { LoggingApplicationCompletionNotifier } from '../credit-application/application-completion.notifier';
import { AiDocumentReviewer } from '../credit-application/document-reviewer';
import { WhatsappMediaDownloader } from '../credit-application/whatsapp-media.downloader';
import { MinioDocumentStorage } from '../credit-application/minio-document.storage';
import { StructuralAntifraudService } from '../credit-application/antifraud.service';
import { ProcessedInboundMessageDeduplicator } from '../credit-application/inbound-message-deduplicator';
import { WhatsappTenantResolver } from '../credit-application/tenant-resolver';
import { CreditApplicationPendingDocumentReminder } from './text/pending-document-reminder.adapter';
import {
  ANTIFRAUD_SERVICE,
  APPLICATION_COMPLETION_NOTIFIER,
  AUDIO_DISPATCHER,
  CONFIG_REPOSITORY,
  CONVERSATION_LOG,
  CREDIT_APPLICATION_REPOSITORY,
  CREDIT_APPLICATION_RESTARTER,
  CREDIT_APPLICATION_STARTER,
  DOCUMENT_DISPATCHER,
  DOCUMENT_REVIEWER,
  DOCUMENT_STORAGE,
  IMAGE_DISPATCHER,
  INBOUND_MESSAGE_DEDUPLICATOR,
  KNOWLEDGE_ASSISTANT,
  MEDIA_DOWNLOADER,
  OUTBOUND_TEXT_SENDER,
  PENDING_DOCUMENT_REMINDER,
  REQUIRED_DOCUMENT_CATALOG,
  TENANT_RESOLVER,
  TEXT_CONSUMER,
} from './conversations.tokens';

/**
 * Cableado del bounded context Conversations + slice de solicitud de crédito: cada
 * puerto de la capa de aplicación se enlaza con su adaptador de infraestructura, y
 * los casos de uso se componen por inyección de dependencias (inversión de dependencias).
 */
@Module({
  imports: [PaymentsModule],
  controllers: [WhatsappWebhookController],
  providers: [
    // Enrutado por tipo de mensaje → adaptadores. Imagen y archivo pasan por el
    // enrutador de media, que decide entre protocolo KYC y recepción de pagos.
    { provide: TEXT_CONSUMER, useClass: WhatsappTextConsumer },
    { provide: AUDIO_DISPATCHER, useClass: AudioDispatchAdapter },
    MediaRouterDispatcher,
    { provide: IMAGE_DISPATCHER, useExisting: MediaRouterDispatcher },
    { provide: DOCUMENT_DISPATCHER, useExisting: MediaRouterDispatcher },

    // Enrutador de media: único dueño de tenant-resolve + dedup + descarga.
    {
      provide: MEDIA_ROUTER,
      inject: [
        TENANT_RESOLVER,
        INBOUND_MESSAGE_DEDUPLICATOR,
        CREDIT_APPLICATION_REPOSITORY,
        CREDIT_PORTFOLIO_REPOSITORY,
        MEDIA_DOWNLOADER,
        MEDIA_CLASSIFIER,
        SubmitApplicationDocumentHandler,
        SubmitPaymentReceiptHandler,
      ],
      useFactory: (
        tenants: TenantResolver,
        dedup: InboundMessageDeduplicator,
        applications: CreditApplicationRepository,
        portfolios: CreditPortfolioRepository,
        downloader: MediaDownloader,
        classifier: MediaClassifier,
        documents: SubmitApplicationDocumentHandler,
        payments: SubmitPaymentReceiptHandler,
      ) =>
        new RouteInboundMediaHandler(
          tenants,
          dedup,
          applications,
          portfolios,
          downloader,
          classifier,
          documents,
          payments,
        ),
    },

    // Transcript de la conversación (entrante + saliente).
    ConversationMessageLog,
    { provide: CONVERSATION_LOG, useExisting: ConversationMessageLog },

    // Puertos del caso de uso de texto → adaptadores.
    { provide: CONFIG_REPOSITORY, useClass: TenantConfigDrizzleRepository },
    { provide: KNOWLEDGE_ASSISTANT, useClass: KnowledgeAssistantRouter },
    // El envío de texto se decora para registrar el mensaje saliente en el transcript.
    WhatsappTextSender,
    {
      provide: OUTBOUND_TEXT_SENDER,
      inject: [WhatsappTextSender, ConversationMessageLog],
      useFactory: (inner: WhatsappTextSender, log: ConversationMessageLog) =>
        new LoggingTextSender(inner, log),
    },
    {
      provide: PENDING_DOCUMENT_REMINDER,
      useClass: CreditApplicationPendingDocumentReminder,
    },

    // Puertos del slice de solicitud de crédito → adaptadores.
    {
      provide: CREDIT_APPLICATION_REPOSITORY,
      useClass: CreditApplicationDrizzleRepository,
    },
    {
      provide: REQUIRED_DOCUMENT_CATALOG,
      useClass: RequiredDocumentCatalogDrizzleRepository,
    },
    {
      provide: APPLICATION_COMPLETION_NOTIFIER,
      useClass: LoggingApplicationCompletionNotifier,
    },
    { provide: DOCUMENT_REVIEWER, useClass: AiDocumentReviewer },
    { provide: MEDIA_DOWNLOADER, useClass: WhatsappMediaDownloader },
    { provide: DOCUMENT_STORAGE, useClass: MinioDocumentStorage },
    { provide: ANTIFRAUD_SERVICE, useClass: StructuralAntifraudService },
    {
      provide: INBOUND_MESSAGE_DEDUPLICATOR,
      useClass: ProcessedInboundMessageDeduplicator,
    },
    { provide: TENANT_RESOLVER, useClass: WhatsappTenantResolver },

    // Caso de uso: inicia/retoma la solicitud (implementa CreditApplicationStarter).
    {
      provide: CREDIT_APPLICATION_STARTER,
      inject: [
        CREDIT_APPLICATION_REPOSITORY,
        OUTBOUND_TEXT_SENDER,
        REQUIRED_DOCUMENT_CATALOG,
      ],
      useFactory: (
        repo: CreditApplicationRepository,
        sender: OutboundTextSender,
        catalog: RequiredDocumentCatalog,
      ) => new StartCreditApplicationHandler(repo, sender, catalog),
    },
    // El mismo handler implementa también el reinicio (CreditApplicationRestarter).
    { provide: CREDIT_APPLICATION_RESTARTER, useExisting: CREDIT_APPLICATION_STARTER },

    // Caso de uso: recibe y valida un documento del protocolo.
    {
      provide: SubmitApplicationDocumentHandler,
      inject: [
        TENANT_RESOLVER,
        INBOUND_MESSAGE_DEDUPLICATOR,
        CREDIT_APPLICATION_REPOSITORY,
        REQUIRED_DOCUMENT_CATALOG,
        MEDIA_DOWNLOADER,
        DOCUMENT_STORAGE,
        ANTIFRAUD_SERVICE,
        OUTBOUND_TEXT_SENDER,
        APPLICATION_COMPLETION_NOTIFIER,
        DOCUMENT_REVIEWER,
      ],
      useFactory: (
        tenants: TenantResolver,
        dedup: InboundMessageDeduplicator,
        repo: CreditApplicationRepository,
        catalog: RequiredDocumentCatalog,
        downloader: MediaDownloader,
        storage: DocumentStorage,
        antifraud: AntifraudService,
        sender: OutboundTextSender,
        completion: ApplicationCompletionNotifier,
        reviewer: DocumentReviewer,
      ) =>
        new SubmitApplicationDocumentHandler(
          tenants,
          dedup,
          repo,
          catalog,
          downloader,
          storage,
          antifraud,
          sender,
          completion,
          reviewer,
        ),
    },

    // Caso de uso de texto (aplicación).
    {
      provide: AnswerTextMessageHandler,
      inject: [
        CONFIG_REPOSITORY,
        INBOUND_MESSAGE_DEDUPLICATOR,
        KNOWLEDGE_ASSISTANT,
        OUTBOUND_TEXT_SENDER,
        CREDIT_APPLICATION_STARTER,
        CREDIT_APPLICATION_RESTARTER,
        PENDING_DOCUMENT_REMINDER,
      ],
      useFactory: (
        configs: TenantAssistantConfigRepository,
        dedup: InboundMessageDeduplicator,
        assistant: KnowledgeAssistant,
        sender: OutboundTextSender,
        credit: CreditApplicationStarter,
        restart: CreditApplicationRestarter,
        reminders: PendingDocumentReminder,
      ) =>
        new AnswerTextMessageHandler(
          configs,
          dedup,
          assistant,
          sender,
          credit,
          restart,
          reminders,
        ),
    },

    // Despachador raíz que clasifica y enruta.
    {
      provide: ProcessInboundMessageHandler,
      inject: [
        TEXT_CONSUMER,
        AUDIO_DISPATCHER,
        IMAGE_DISPATCHER,
        DOCUMENT_DISPATCHER,
        CONVERSATION_LOG,
      ],
      useFactory: (
        text: TextMessageConsumer,
        audio: AudioMessageDispatcher,
        image: ImageMessageDispatcher,
        document: DocumentMessageDispatcher,
        log: ConversationLog,
      ) => new ProcessInboundMessageHandler(text, audio, image, document, log),
    },
  ],
})
export class ConversationsModule {}
