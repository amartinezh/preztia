import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { ProcessInboundMessageHandler } from '@preztiaos/application';
import { whatsappWebhookEvent } from '@preztiaos/contracts';
import { isValidSignature } from './whatsapp-signature';
import { toInboundMessages } from './whatsapp-message.mapper';
import {
  resolveWhatsappCredentialsByPhone,
  whatsappVerifyTokenHashExists,
} from '../tenancy/unit-of-work';

/**
 * Adaptador de entrada del bounded context Conversations.
 *
 *  GET  /webhooks/whatsapp  → handshake de verificación de Meta (devuelve el challenge).
 *  POST /webhooks/whatsapp  → recibe mensajes, verifica firma, normaliza y enruta.
 */
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly process: ProcessInboundMessageHandler) {}

  @Get()
  async verify(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token && (await this.tokenAccepted(token))) {
      res.status(200).send(challenge);
      return;
    }
    throw new ForbiddenException('Verificación de webhook fallida');
  }

  /**
   * El verify token del handshake se acepta si coincide con el de algún canal (comparado por hash
   * SHA-256) o con la variable de entorno (fallback). El handshake no trae phone_number_id, por eso
   * se comprueba contra el conjunto de canales configurados.
   */
  private async tokenAccepted(token: string): Promise<boolean> {
    const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (envToken && token === envToken) return true;
    const hash = createHash('sha256').update(token).digest('hex');
    return whatsappVerifyTokenHashExists(hash);
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    await this.assertAuthentic(
      req.rawBody,
      signature,
      extractPhoneNumberId(body),
    );

    const parsed = whatsappWebhookEvent.safeParse(body);
    if (!parsed.success) {
      // No es un evento de mensajería que entendamos: respondemos 200 para que
      // Meta no reintente, pero lo dejamos trazado.
      this.logger.warn(
        'Evento de webhook ignorado (no coincide con el esquema)',
      );
      return { received: true };
    }

    const messages = toInboundMessages(parsed.data);
    for (const message of messages) {
      try {
        await this.process.execute(message);
      } catch (err) {
        // Resiliencia: un fallo al procesar un mensaje NO debe escalar a 500, porque Meta
        // reentregaría el webhook en bucle (amplificando el problema y el consumo de IA).
        // Lo registramos y seguimos; respondemos 200 para cortar la reentrega.
        this.logger.error(
          `Error procesando mensaje ${message.id} (canal ${message.channelId})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return { received: true };
  }

  /**
   * Rechaza el evento si la firma HMAC no coincide con el App Secret. El secreto se resuelve por el
   * `phone_number_id` del canal (BD, cifrado) y cae a la variable de entorno (migración sin
   * downtime). Extraer el número del cuerpo aún-no-verificado solo sirve para ELEGIR el secreto: no
   * se actúa sobre el contenido hasta validar la firma.
   */
  private async assertAuthentic(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    phoneNumberId: string | undefined,
  ): Promise<void> {
    const creds = phoneNumberId
      ? await resolveWhatsappCredentialsByPhone(phoneNumberId)
      : null;
    const appSecret = creds?.appSecret ?? process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      // Sin secreto configurado solo tiene sentido en desarrollo local.
      this.logger.warn(
        'WHATSAPP_APP_SECRET no configurado: se omite la verificación de firma',
      );
      return;
    }
    if (!rawBody || !isValidSignature(rawBody, signature, appSecret)) {
      throw new ForbiddenException('Firma de webhook inválida');
    }
  }
}

/**
 * Extrae el `phone_number_id` del cuerpo del webhook (aún no verificado) para elegir el App Secret
 * del canal. Defensivo: cualquier forma inesperada devuelve `undefined` (cae al secreto de entorno).
 */
function extractPhoneNumberId(body: unknown): string | undefined {
  const firstItem = (v: unknown): unknown =>
    Array.isArray(v) ? (v as unknown[])[0] : undefined;
  const entry = firstItem((body as { entry?: unknown })?.entry);
  const change = firstItem((entry as { changes?: unknown })?.changes);
  const id = (
    change as { value?: { metadata?: { phone_number_id?: unknown } } }
  )?.value?.metadata?.phone_number_id;
  return typeof id === 'string' ? id : undefined;
}
