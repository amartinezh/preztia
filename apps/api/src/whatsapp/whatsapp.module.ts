import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappChannelRepository } from './whatsapp-channel.repository';
import { ConversationsInboxQueryRepository } from './conversations-inbox-query.repository';

/**
 * Módulo de WhatsApp: canales (número→zona) y bandeja de conversaciones (scopeada por zona).
 * Plano de datos bajo el rol `app` + RLS y `JwtGuard`.
 */
@Module({
  controllers: [WhatsappController],
  providers: [WhatsappChannelRepository, ConversationsInboxQueryRepository],
})
export class WhatsappModule {}
