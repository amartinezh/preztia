import { Module } from '@nestjs/common';
import {
  type MessagingChannelsReader,
  RegisterTelegramChannelHandler,
  RemoveTelegramChannelHandler,
  RotateTelegramBotTokenHandler,
  type TelegramBotGateway,
  type TelegramChannelStore,
  type TelegramWebhookEndpoint,
  type TelegramWebhookSecrets,
  VerifyTelegramWebhookHandler,
} from '@preztiaos/application';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MessagingChannelsRepository } from '../tenant-config/messaging-channels.repository';
import { TelegramChannelController } from './telegram-channel.controller';
import { TelegramChannelRepository } from './telegram-channel.repository';
import { TelegramBotApiClient } from './telegram-bot-api.client';
import {
  RandomTelegramWebhookSecrets,
  TelegramWebhookEndpointConfig,
} from './telegram-webhook.config';

/**
 * Módulo de Telegram (ADR #40): alta, rotación, verificación y baja de bots por zona. Cada puerto
 * de la aplicación se enlaza con su adaptador (Bot API, Drizzle, entorno, CSPRNG).
 */
@Module({
  imports: [TenantConfigModule],
  controllers: [TelegramChannelController],
  providers: [
    TelegramChannelRepository,
    TelegramBotApiClient,
    TelegramWebhookEndpointConfig,
    RandomTelegramWebhookSecrets,
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
