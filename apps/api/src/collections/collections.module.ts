import { Module } from '@nestjs/common';
import {
  type CollectionAuditLog,
  type DueCreditsReader,
  type OutboundTextSender,
  type ReminderIdempotencyStore,
  RunTenantCollectionRemindersHandler,
  SendCollectionReminderHandler,
} from '@preztiaos/application';
import { CollectionsController } from './collections.controller';
import { DueCreditsRepository } from './due-credits.repository';
import { DueTenantsRepository } from './due-tenants.repository';
import { ReminderIdempotencyRepository } from './reminder-idempotency.repository';
import { CollectionAuditLogAdapter } from './collection-audit.log';
import { CollectionReminderCron } from './collection-reminder.cron';
import { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import { LoggingTextSender } from '../conversations/text/logging-text-sender';
import { ConversationMessageLog } from '../conversations/conversation-message.log';

/**
 * Cableado del bounded context COBRANZA: cada puerto de la capa de aplicación se enlaza con su
 * adaptador de infraestructura y los casos de uso se componen por inyección de dependencias.
 * Reutiliza el envío de texto de Conversations (que ADEMÁS registra el mensaje saliente en el
 * transcript `conversation_message`, satisfaciendo el log de auditoría del hilo). El cron de
 * `@nestjs/schedule` activa el envío automático; el controlador, el manual.
 */
@Module({
  controllers: [CollectionsController],
  providers: [
    DueCreditsRepository,
    DueTenantsRepository,
    ReminderIdempotencyRepository,
    CollectionAuditLogAdapter,

    // Envío saliente reutilizado: el adaptador real decorado para registrar el transcript.
    WhatsappTextSender,
    ConversationMessageLog,
    {
      provide: LoggingTextSender,
      inject: [WhatsappTextSender, ConversationMessageLog],
      useFactory: (inner: WhatsappTextSender, log: ConversationMessageLog) =>
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
