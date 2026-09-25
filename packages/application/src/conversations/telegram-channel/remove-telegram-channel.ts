import { NotFoundError } from "@preztiaos/domain";
import type { TelegramBotGateway, TelegramChannelStore } from "./ports";

/** Resultado de la baja: si Telegram confirmó el retiro del webhook. */
export interface TelegramChannelRemoval {
  readonly webhookDeleted: boolean;
}

/**
 * Caso de uso: desvincular el bot de la zona. Primero se retira el webhook en Telegram para que el
 * bot deje de enviar updates; si Telegram no lo confirma (token ya revocado, caída), la baja local
 * procede igual — el webhook huérfano quedaría rechazado (403) porque su id deja de existir — y se
 * informa en el resultado para que quede trazado.
 */
export class RemoveTelegramChannelHandler {
  constructor(
    private readonly gateway: TelegramBotGateway,
    private readonly store: TelegramChannelStore,
  ) {}

  async execute(input: { tenantId: string; id: string }): Promise<TelegramChannelRemoval> {
    const channel = await this.store.findCredentials(input);
    if (!channel) throw new NotFoundError("Canal de Telegram no encontrado");

    const webhookDeleted = await this.gateway
      .deleteWebhook(channel.botToken)
      .then(() => true)
      .catch(() => false);
    await this.store.remove(input);
    return { webhookDeleted };
  }
}
