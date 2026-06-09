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
import { ProcessInboundMessageHandler } from '@preztiaos/application';
import { whatsappWebhookEvent } from '@preztiaos/contracts';
import { isValidSignature } from './whatsapp-signature';
import { toInboundMessages } from './whatsapp-message.mapper';

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
  verify(@Query() query: Record<string, string>, @Res() res: Response): void {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      token &&
      token === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      res.status(200).send(challenge);
      return;
    }
    throw new ForbiddenException('Verificación de webhook fallida');
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    this.assertAuthentic(req.rawBody, signature);

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

  /** Rechaza el evento si la firma HMAC no coincide con el App Secret. */
  private assertAuthentic(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): void {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
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
