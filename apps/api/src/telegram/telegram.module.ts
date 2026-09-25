import { Module } from '@nestjs/common';
import {
  IdentifyTelegramSenderHandler,
  type MessagingChannelsReader,
  RegisterTelegramChannelHandler,
  RemoveTelegramChannelHandler,
  RotateTelegramBotTokenHandler,
  type TelegramBotGateway,
  type TelegramChannelStore,
  type TelegramChatLinkStore,
  type TelegramContactPrompter,
  type TelegramWebhookEndpoint,
  type TelegramWebhookSecrets,
  VerifyTelegramWebhookHandler,
} from '@preztiaos/application';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingChannelsRepository } from '../tenant-config/messaging-channels.repository';
import { TelegramChannelController } from './telegram-channel.controller';
import { TelegramChannelRepository } from './telegram-channel.repository';
import { TelegramBotApiClient } from './telegram-bot-api.client';
import { TelegramChatLinkRepository } from './telegram-chat-link.repository';
import { TelegramContactPrompterAdapter } from './telegram-contact.prompter';
import { TelegramWebhookController } from './telegram-webhook.controller';
import {
  RandomTelegramWebhookSecrets,
  TelegramWebhookEndpointConfig,
} from './telegram-webhook.config';

/**
 * Módulo de Telegram (ADR #40): alta, rotación, verificación y baja de bots por zona, y la
 * ENTRADA de mensajes (webhook + verificación del contacto) hacia el mismo despachador que WhatsApp.
 * Cada puerto de la aplicación se enlaza con su adaptador (Bot API, Drizzle, entorno, CSPRNG).
 */
@Module({
  imports: [TenantConfigModule, ConversationsModule],
  controllers: [TelegramChannelController, TelegramWebhookController],
  providers: [
    TelegramChannelRepository,
    TelegramBotApiClient,
    TelegramWebhookEndpointConfig,
    RandomTelegramWebhookSecrets,
    TelegramChatLinkRepository,
    TelegramContactPrompterAdapter,

    // Entrada: identificación del remitente por su teléfono verificado (gate de contacto).
    {
      provide: IdentifyTelegramSenderHandler,
      inject: [TelegramChatLinkRepository, TelegramContactPrompterAdapter],
      useFactory: (
        links: TelegramChatLinkStore,
        prompter: TelegramContactPrompter,
      ) => new IdentifyTelegramSenderHandler(links, prompter),
    },

    // Alta y mantenimiento de bots por zona.
    {
      provide: RegisterTelegramChannelHandler,
      inject: [
        MessagingChannelsRepository,
        TelegramBotApiClient,
        TelegramChannelRepository,
        TelegramWebhookEndpointConfig,
        RandomTelegramWebhookSecrets,
      ],
      useFactory: (
        settings: MessagingChannelsReader,
        gateway: TelegramBotGateway,
        store: TelegramChannelStore,
        endpoint: TelegramWebhookEndpoint,
        secrets: TelegramWebhookSecrets,
      ) =>
        new RegisterTelegramChannelHandler(
          settings,
          gateway,
          store,
          endpoint,
          secrets,
        ),
    },
    {
      provide: RotateTelegramBotTokenHandler,
      inject: [
        TelegramBotApiClient,
        TelegramChannelRepository,
        TelegramWebhookEndpointConfig,
      ],
      useFactory: (
        gateway: TelegramBotGateway,
        store: TelegramChannelStore,
        endpoint: TelegramWebhookEndpoint,
      ) => new RotateTelegramBotTokenHandler(gateway, store, endpoint),
    },
    {
      provide: VerifyTelegramWebhookHandler,
      inject: [
        TelegramBotApiClient,
        TelegramChannelRepository,
        TelegramWebhookEndpointConfig,
      ],
      useFactory: (
        gateway: TelegramBotGateway,
        store: TelegramChannelStore,
        endpoint: TelegramWebhookEndpoint,
      ) => new VerifyTelegramWebhookHandler(gateway, store, endpoint),
    },
    {
      provide: RemoveTelegramChannelHandler,
      inject: [TelegramBotApiClient, TelegramChannelRepository],
      useFactory: (gateway: TelegramBotGateway, store: TelegramChannelStore) =>
        new RemoveTelegramChannelHandler(gateway, store),
    },
  ],
})
export class TelegramModule {}
