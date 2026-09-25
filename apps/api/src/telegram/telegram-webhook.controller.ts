import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  IdentifyTelegramSenderHandler,
  ProcessInboundMessageHandler,
  type TelegramInbound,
} from '@preztiaos/application';
import {
  type InboundMessage,
  isProviderEnabled,
  telegramInboundMessageId,
  verifiedPhoneOf,
} from '@preztiaos/domain';
import { telegramUpdate } from '@preztiaos/contracts';
import { ConversationFailureLog } from '../conversations/conversation-failure.log';
import { MessagingChannelsRepository } from '../tenant-config/messaging-channels.repository';
import {
  resolveTelegramWebhookTarget,
  type TelegramWebhookTarget,
} from '../tenancy/unit-of-work';
import { toTelegramInbound } from './telegram-update.mapper';

// Forma del id opaco de la URL (base64url de 32 bytes = 43 caracteres). Se valida antes de tocar
// la BD: un id con otra forma no puede corresponder a ningún bot.
const HOOK_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * Adaptador de entrada de Telegram (ADR #40): `POST /webhooks/telegram/:hookId`.
 *
 * FALLA CERRADO (403) si no se puede probar la autenticidad: id de URL desconocido, o header
 * `X-Telegram-Bot-Api-Secret-Token` ausente o distinto del secret del bot. Es la lección del
 * hallazgo #1 de SECURITY_AUDIT (el webhook de WhatsApp aceptaba eventos sin verificar): un
 * update falso permitiría suplantar a un cliente y empujar su crédito.
 *
 * Autenticado el update, SIEMPRE responde 200: Telegram reentrega ante cualquier otro estado, y
 * un fallo nuestro reintentado en bucle solo amplifica el problema. Los fallos van a la bitácora.
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger('Telegram:Webhook');

  constructor(
    private readonly identify: IdentifyTelegramSenderHandler,
    private readonly process: ProcessInboundMessageHandler,
    private readonly failures: ConversationFailureLog,
    private readonly settings: MessagingChannelsRepository,
  ) {}

  @Post(':hookId')
  @HttpCode(200)
  async receive(
    @Param('hookId') hookId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const target = await this.authenticate(hookId, secret);
    const inbound = await this.acceptedInbound(target, body);
    if (!inbound) return { received: true };

    const message = await this.identifySender(target, inbound);
    if (message) await this.route(message);
    return { received: true };
  }

  private async authenticate(
    hookId: string,
    secret: string | undefined,
  ): Promise<TelegramWebhookTarget> {
    const target = HOOK_ID.test(hookId)
      ? await resolveTelegramWebhookTarget(hookId)
      : null;
    if (!target || !secret || !sameSecret(secret, target.secretToken)) {
      this.logger.warn('Update de Telegram RECHAZADO: webhook no autenticado');
      throw new ForbiddenException('Webhook de Telegram no autenticado');
    }
    return target;
  }

  /** Update autenticado que el tenant atiende; `null` si se descarta (con 200). */
  private async acceptedInbound(
    target: TelegramWebhookTarget,
    body: unknown,
  ): Promise<TelegramInbound | null> {
    const settings = await this.settings.get(target.tenantId);
    if (!isProviderEnabled(settings, 'TELEGRAM')) {
      this.logger.warn(
        `Telegram deshabilitado en el tenant: update del canal ${target.channelId} descartado`,
      );
      return null;
    }
    const parsed = telegramUpdate.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        `Update de Telegram ignorado (no coincide con el esquema) en canal ${target.channelId}`,
      );
      return null;
    }
    return toTelegramInbound(parsed.data);
  }

  private async identifySender(
    target: TelegramWebhookTarget,
    inbound: TelegramInbound,
  ): Promise<InboundMessage | null> {
    try {
      return await this.identify.execute({
        tenantId: target.tenantId,
        channelId: target.channelId,
        inbound,
      });
    } catch (err) {
      this.logger.error(
        `Error identificando al remitente (${inbound.type}) en canal ${target.channelId}`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.recordContactFailure(target.channelId, inbound, err);
      return null;
    }
  }

  /** Solo un contacto PROPIO y válido tiene teléfono al que atribuir el fallo. */
  private async recordContactFailure(
    channelId: string,
    inbound: TelegramInbound,
    err: unknown,
  ): Promise<void> {
    if (inbound.type !== 'contact') return;
    let applicantPhone: string;
    try {
      applicantPhone = verifiedPhoneOf(inbound);
    } catch {
      return; // contacto ajeno o inválido: no es atribuible (y no es un fallo nuestro)
    }
    await this.failures.recordContactVerification(
      {
        channelId,
        applicantPhone,
        messageId: telegramInboundMessageId(
          channelId,
          inbound.chatId,
          inbound.messageId,
        ),
      },
      err,
    );
  }

  private async route(message: InboundMessage): Promise<void> {
    this.logger.log(
      `Update: mensaje [${message.kind}] en canal ${message.channelId}`,
    );
    try {
      await this.process.execute(message);
    } catch (err) {
      this.logger.error(
        `Error procesando mensaje ${message.id} (canal ${message.channelId})`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.failures.record(message, err);
    }
  }
}

/**
 * Compara el secret recibido con el del bot en tiempo constante. Se comparan los SHA-256 para
 * que ambos buffers tengan igual longitud sin filtrar la longitud del secret real.
 */
function sameSecret(received: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}
