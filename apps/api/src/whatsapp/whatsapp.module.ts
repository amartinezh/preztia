import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappChannelRepository } from './whatsapp-channel.repository';
import { ConversationsInboxQueryRepository } from './conversations-inbox-query.repository';
import { ConversationsPurgeRepository } from './conversations-purge.repository';

/**
 * Módulo de WhatsApp: canales (número→zona) y bandeja de conversaciones (scopeada por zona),
 * con su estadística por desenlace y su depuración. Plano de datos bajo el rol `app` + RLS
 * y `JwtGuard`.
 */
@Module({
  controllers: [WhatsappController],
  providers: [
    WhatsappChannelRepository,
    ConversationsInboxQueryRepository,
    ConversationsPurgeRepository,
  ],
})
export class WhatsappModule {}
