import { Module } from '@nestjs/common';
import {
  AnswerTextMessageHandler,
  type AntifraudService,
  type ApplicationCompletionNotifier,
  type AudioMessageDispatcher,
  type CreditApplicationRepository,
  type CreditApplicationStarter,
  type DocumentMessageDispatcher,
  type DocumentReviewer,
  type DocumentStorage,
  type ImageMessageDispatcher,
  type InboundMessageDeduplicator,
  type KnowledgeAssistant,
  type MediaDownloader,
  type OutboundTextSender,
  type PendingDocumentReminder,
  ProcessInboundMessageHandler,
  type RequiredDocumentCatalog,
  StartCreditApplicationHandler,
  SubmitApplicationDocumentHandler,
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
import { ImageDocumentDispatcher } from '../credit-application/adapters/image-document.dispatcher';
import { FileDocumentDispatcher } from '../credit-application/adapters/file-document.dispatcher';
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
  CREDIT_APPLICATION_REPOSITORY,
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
  controllers: [WhatsappWebhookController],
  providers: [
    // Enrutado por tipo de mensaje → adaptadores.
    { provide: TEXT_CONSUMER, useClass: WhatsappTextConsumer },
    { provide: AUDIO_DISPATCHER, useClass: AudioDispatchAdapter },
    { provide: IMAGE_DISPATCHER, useClass: ImageDocumentDispatcher },
    { provide: DOCUMENT_DISPATCHER, useClass: FileDocumentDispatcher },

    // Puertos del caso de uso de texto → adaptadores.
    { provide: CONFIG_REPOSITORY, useClass: TenantConfigDrizzleRepository },
    { provide: KNOWLEDGE_ASSISTANT, useClass: KnowledgeAssistantRouter },
    { provide: OUTBOUND_TEXT_SENDER, useClass: WhatsappTextSender },
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
        PENDING_DOCUMENT_REMINDER,
      ],
      useFactory: (
        configs: TenantAssistantConfigRepository,
        dedup: InboundMessageDeduplicator,
        assistant: KnowledgeAssistant,
        sender: OutboundTextSender,
        credit: CreditApplicationStarter,
        reminders: PendingDocumentReminder,
      ) =>
        new AnswerTextMessageHandler(
          configs,
          dedup,
          assistant,
          sender,
          credit,
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
      ],
      useFactory: (
        text: TextMessageConsumer,
        audio: AudioMessageDispatcher,
        image: ImageMessageDispatcher,
        document: DocumentMessageDispatcher,
      ) => new ProcessInboundMessageHandler(text, audio, image, document),
    },
  ],
})
export class ConversationsModule {}
