import { Injectable } from '@nestjs/common';
import { type TenantResolver } from '@preztiaos/application';
import { resolveTenantByChannel } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto TenantResolver: resuelve el tenant por el canal de mensajería (`channelId`),
 * sea un `phone_number_id` de WhatsApp o un bot de Telegram (`tg:<bot_id>`, ADR #40).
 */
@Injectable()
export class ChannelTenantResolver implements TenantResolver {
  resolveByChannel(channelId: string): Promise<string | null> {
    return resolveTenantByChannel(channelId);
  }
}
