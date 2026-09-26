import { Module } from '@nestjs/common';
import {
  AddCollectionObservationHandler,
  type CollectionAuditLog,
  type CollectionNoteRepository,
  type CollectionVisitAuditLog,
  type CollectionVisitRepository,
  type DueCreditsReader,
  MarkCollectionVisitedHandler,
  type OutboundTextSender,
  type ReminderIdempotencyStore,
  RunTenantCollectionRemindersHandler,
  SendCollectionReminderHandler,
  type VisitOverdueReader,
} from '@preztiaos/application';
import { CollectionsController } from './collections.controller';
import { DueCreditsRepository } from './due-credits.repository';
import { CriticalClientsRepository } from './critical-clients.repository';
import { PortfolioMapRepository } from './portfolio-map.repository';
import { OsrmRouteOptimizer } from './osrm-route-optimizer';
import { DueTenantsRepository } from './due-tenants.repository';
import { ReminderIdempotencyRepository } from './reminder-idempotency.repository';
import { CollectionAuditLogAdapter } from './collection-audit.log';
import { CollectionReminderCron } from './collection-reminder.cron';
import { VisitTargetsRepository } from './visit-targets.repository';
import { CollectionNoteRepositoryAdapter } from './collection-note.repository';
import { CollectionVisitRepositoryAdapter } from './collection-visit.repository';
import { CollectionVisitAuditLogAdapter } from './collection-visit-audit.log';
import { CollectionLogRepository } from './collection-log.repository';
import { ChannelRoutingTextSender } from '../messaging/channel-routing.text-sender';
import { MessagingModule } from '../messaging/messaging.module';
import { LoggingTextSender } from '../conversations/text/logging-text-sender';
import { ConversationMessageLog } from '../conversations/conversation-message.log';

/**
 * Cableado del bounded context COBRANZA: cada puerto de la capa de aplicación se enlaza con su
 * adaptador de infraestructura y los casos de uso se componen por inyección de dependencias.
 * Reutiliza el envío de texto de Conversations (que ADEMÁS registra el mensaje saliente en el
 * transcript `conversation_message`, satisfaciendo el log de auditoría del hilo). El cron de
 * `@nestjs/schedule` activa el envío automático; el controlador, el manual.
 */
import { CollectionRouteController } from './collection-route.controller';
import { CollectionRouteDrizzleRepository } from './collection-route.repository';
import { CollectionRouteQueryRepository } from './collection-route-query.repository';

@Module({
  imports: [MessagingModule],
  controllers: [CollectionsController, CollectionRouteController],
  providers: [
    DueCreditsRepository,
    DueTenantsRepository,
    CriticalClientsRepository,
    PortfolioMapRepository,
    OsrmRouteOptimizer,
    // Órdenes de ruta (Fase 5): despacho de paradas a cobradores y su liquidación.
    CollectionRouteDrizzleRepository,
    CollectionRouteQueryRepository,
    ReminderIdempotencyRepository,
    CollectionAuditLogAdapter,

    // Visitas de cobro en campo (perfil del cobrador): read model + adaptadores append-only.
    VisitTargetsRepository,
    CollectionNoteRepositoryAdapter,
    CollectionVisitRepositoryAdapter,
    CollectionVisitAuditLogAdapter,
    CollectionLogRepository,
    {
      provide: AddCollectionObservationHandler,
      inject: [VisitTargetsRepository, CollectionNoteRepositoryAdapter],
      useFactory: (
        overdue: VisitOverdueReader,
        notes: CollectionNoteRepository,
      ) => new AddCollectionObservationHandler(overdue, notes),
    },
    {
      provide: MarkCollectionVisitedHandler,
      inject: [
        VisitTargetsRepository,
        CollectionNoteRepositoryAdapter,
        CollectionVisitRepositoryAdapter,
        CollectionVisitAuditLogAdapter,
      ],
      useFactory: (
        overdue: VisitOverdueReader,
        notes: CollectionNoteRepository,
        visits: CollectionVisitRepository,
        audit: CollectionVisitAuditLog,
      ) => new MarkCollectionVisitedHandler(overdue, notes, visits, audit),
    },

    // Envío saliente reutilizado: el router por proveedor decorado para registrar el transcript.
    ConversationMessageLog,
    {
      provide: LoggingTextSender,
      inject: [ChannelRoutingTextSender, ConversationMessageLog],
      useFactory: (inner: OutboundTextSender, log: ConversationMessageLog) =>
        new LoggingTextSender(inner, log),
    },

    // Caso de uso: enviar UN recordatorio (común a manual y automático).
    {
      provide: SendCollectionReminderHandler,
      inject: [
        DueCreditsRepository,
        LoggingTextSender,
        ReminderIdempotencyRepository,
        CollectionAuditLogAdapter,
      ],
      useFactory: (
        dueCredits: DueCreditsReader,
        sender: OutboundTextSender,
        idempotency: ReminderIdempotencyStore,
        audit: CollectionAuditLog,
      ) =>
        new SendCollectionReminderHandler(
          dueCredits,
          sender,
          idempotency,
          audit,
        ),
    },

    // Caso de uso: correr la cobranza de un tenant (lo invoca el cron).
    {
      provide: RunTenantCollectionRemindersHandler,
      inject: [DueCreditsRepository, SendCollectionReminderHandler],
      useFactory: (
        dueCredits: DueCreditsReader,
        reminder: SendCollectionReminderHandler,
      ) => new RunTenantCollectionRemindersHandler(dueCredits, reminder),
    },

    CollectionReminderCron,
  ],
})
export class CollectionsModule {}
