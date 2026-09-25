import { ConflictError, isProviderEnabled } from "@preztiaos/domain";
import type {
  MessagingChannelsReader,
  TelegramBotGateway,
  TelegramChannelStore,
  TelegramWebhookEndpoint,
  TelegramWebhookSecrets,
} from "./ports";

/**
 * Caso de uso: vincular un bot de Telegram a una zona y dejarlo recibiendo mensajes (ADR #40).
 *
 *   1. Telegram habilitado en el tenant (si no, el bot quedaría registrado pero mudo).
 *   2. getMe valida el token y da la identidad del bot (bot_id, @username).
 *   3. Se persiste el canal con un id de URL y un secret token NUEVOS (la unicidad del bot y de la
 *      zona la garantiza la BD).
 *   4. setWebhook en Telegram; si falla, se DESHACE el alta: un canal sin webhook no atendería a
 *      nadie y bloquearía la zona. El canal persistido antes que el webhook evita apuntar un bot
 *      ajeno a una URL que no existe si la unicidad falla.
 */
export class RegisterTelegramChannelHandler {
  constructor(
    private readonly settings: MessagingChannelsReader,
    private readonly gateway: TelegramBotGateway,
    private readonly store: TelegramChannelStore,
    private readonly endpoint: TelegramWebhookEndpoint,
    private readonly secrets: TelegramWebhookSecrets,
  ) {}

  async execute(input: {
    tenantId: string;
    zoneId: string;
    botToken: string;
  }): Promise<{ id: string }> {
    await this.assertTelegramEnabled(input.tenantId);
    const bot = await this.gateway.getMe(input.botToken);
    const hookId = this.secrets.newHookId();
    const secretToken = this.secrets.newSecretToken();
    // Falla rápido (antes de persistir) si el despliegue no tiene URL pública configurada.
    const url = this.endpoint.urlFor(hookId);

    const { id } = await this.store.create({
      tenantId: input.tenantId,
      zoneId: input.zoneId,
      bot,
      botToken: input.botToken,
      hookId,
      secretToken,
    });
    try {
      await this.gateway.setWebhook(input.botToken, {
        url,
        secretToken,
        dropPendingUpdates: true,
      });
    } catch (error) {
      await this.store.remove({ tenantId: input.tenantId, id });
      throw error;
    }
    await this.store.markWebhookRegistered({ tenantId: input.tenantId, id });
    return { id };
  }

  private async assertTelegramEnabled(tenantId: string): Promise<void> {
    const settings = await this.settings.get(tenantId);
    if (!isProviderEnabled(settings, "TELEGRAM")) {
      throw new ConflictError(
        "Telegram no está habilitado en el tenant: actívalo en Ajustes antes de vincular un bot",
        "TELEGRAM_DISABLED",
      );
    }
  }
}
