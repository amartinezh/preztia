import {
  mergeMessagingChannels,
  type MessagingChannelsSettings,
} from "@preztiaos/domain";

// Caso de uso: habilitar/deshabilitar WhatsApp y Telegram en el tenant (ADR #40). La mezcla del
// parche y sus invariantes son puras (dominio); la persistencia va por el puerto.

export interface MessagingChannelsStore {
  get(tenantId: string): Promise<MessagingChannelsSettings>;
  save(input: { tenantId: string; settings: MessagingChannelsSettings }): Promise<void>;
}

export class UpdateMessagingChannelsHandler {
  constructor(private readonly store: MessagingChannelsStore) {}

  async execute(input: {
    tenantId: string;
    patch: Partial<MessagingChannelsSettings>;
  }): Promise<MessagingChannelsSettings> {
    const current = await this.store.get(input.tenantId);
    const next = mergeMessagingChannels(current, input.patch);
    await this.store.save({ tenantId: input.tenantId, settings: next });
    return next;
  }
}
