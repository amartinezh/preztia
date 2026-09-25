import { assertSameTelegramBot, NotFoundError } from "@preztiaos/domain";
import type {
  TelegramBotGateway,
  TelegramChannelStore,
  TelegramWebhookEndpoint,
} from "./ports";

/**
 * Caso de uso: rotar el token del bot (p. ej. tras /revoke en BotFather). El token nuevo debe ser
 * del MISMO bot (regla de dominio). Se re-registra el webhook con la misma URL y el mismo secret
 * ANTES de persistir: si Telegram lo rechaza, el canal conserva el token anterior intacto. Los
 * updates encolados se conservan (no se descartan mensajes de clientes al rotar).
 */
export class RotateTelegramBotTokenHandler {
  constructor(
    private readonly gateway: TelegramBotGateway,
    private readonly store: TelegramChannelStore,
    private readonly endpoint: TelegramWebhookEndpoint,
  ) {}

  async execute(input: {
    tenantId: string;
    id: string;
    botToken: string;
  }): Promise<void> {
    const current = await this.store.findCredentials({
      tenantId: input.tenantId,
      id: input.id,
    });
    if (!current) throw new NotFoundError("Canal de Telegram no encontrado");

    const bot = await this.gateway.getMe(input.botToken);
    assertSameTelegramBot(current.botId, bot.botId);

    await this.gateway.setWebhook(input.botToken, {
      url: this.endpoint.urlFor(current.hookId),
      secretToken: current.secretToken,
      dropPendingUpdates: false,
    });
    await this.store.replaceToken({
      tenantId: input.tenantId,
      id: input.id,
      botToken: input.botToken,
      username: bot.username,
    });
    await this.store.markWebhookRegistered({ tenantId: input.tenantId, id: input.id });
  }
}
