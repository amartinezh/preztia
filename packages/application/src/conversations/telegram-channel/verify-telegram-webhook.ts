import { NotFoundError } from "@preztiaos/domain";
import type {
  TelegramBotGateway,
  TelegramChannelCredentials,
  TelegramChannelStore,
  TelegramWebhookEndpoint,
  TelegramWebhookInfo,
} from "./ports";

export interface TelegramWebhookStatus {
  readonly webhookRegistered: boolean;
  /** true si esta verificación tuvo que volver a registrar el webhook. */
  readonly reRegistered: boolean;
  readonly pendingUpdateCount: number;
  readonly lastErrorMessage: string | null;
  readonly lastErrorAt: Date | null;
}

/**
 * Caso de uso: comprobar en Telegram que el webhook del bot apunta a este servidor y, si no (otra
 * herramienta lo cambió, se migró el dominio…), volver a registrarlo. Es la acción "Verificar" del
 * panel de la zona: diagnostica (errores de entrega, updates encolados) y se autocorrige.
 */
export class VerifyTelegramWebhookHandler {
  constructor(
    private readonly gateway: TelegramBotGateway,
    private readonly store: TelegramChannelStore,
    private readonly endpoint: TelegramWebhookEndpoint,
  ) {}

  async execute(input: { tenantId: string; id: string }): Promise<TelegramWebhookStatus> {
    const channel = await this.store.findCredentials(input);
    if (!channel) throw new NotFoundError("Canal de Telegram no encontrado");

    const expectedUrl = this.endpoint.urlFor(channel.hookId);
    const info = await this.gateway.getWebhookInfo(channel.botToken);
    if (info.url === expectedUrl) return toStatus(info, expectedUrl, false);

    await this.reRegister(input, channel, expectedUrl);
    const refreshed = await this.gateway.getWebhookInfo(channel.botToken);
    return toStatus(refreshed, expectedUrl, true);
  }

  private async reRegister(
    ids: { tenantId: string; id: string },
    channel: TelegramChannelCredentials,
    url: string,
  ): Promise<void> {
    await this.gateway.setWebhook(channel.botToken, {
      url,
      secretToken: channel.secretToken,
      dropPendingUpdates: false,
    });
    await this.store.markWebhookRegistered(ids);
  }
}

function toStatus(
  info: TelegramWebhookInfo,
  expectedUrl: string,
  reRegistered: boolean,
): TelegramWebhookStatus {
  return {
    webhookRegistered: info.url === expectedUrl,
    reRegistered,
    pendingUpdateCount: info.pendingUpdateCount,
    lastErrorMessage: info.lastErrorMessage,
    lastErrorAt: info.lastErrorAt,
  };
}
