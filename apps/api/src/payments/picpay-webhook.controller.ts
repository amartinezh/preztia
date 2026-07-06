import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { IngestPicPayWebhookService } from './ingest-picpay-webhook.service';

const uuid = z.string().uuid();

/**
 * Webhook de PicPay (`TransactionUpdateMessage`). URL por tenant: el token del header
 * `Authorization` (generado por PicPay en el Painel Lojista, guardado cifrado por el tenant)
 * autentica la notificación, así que el tenantId del path no necesita ser secreto. Endpoint
 * público (sin JWT): la autenticidad la da el token. Idempotente ante reentregas (bitácora e
 * ingestión deduplican).
 */
@Controller('webhooks/picpay')
export class PicPayWebhookController {
  private readonly logger = new Logger(PicPayWebhookController.name);

  constructor(private readonly ingest: IngestPicPayWebhookService) {}

  @Post(':tenantId')
  @HttpCode(200)
  async receive(
    @Param('tenantId') tenantIdParam: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('event-type') eventType: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const tenant = uuid.safeParse(tenantIdParam);
    if (!tenant.success) {
      // tenantId malformado: se trata como notificación no autenticable.
      throw new UnauthorizedException('Webhook inválido');
    }

    try {
      await this.ingest.ingest({
        tenantId: tenant.data,
        authorizationHeader: authorization,
        eventTypeHeader: eventType,
        body,
      });
    } catch (err) {
      // Token inválido → 401 (no confirmamos una notificación forjada).
      if (err instanceof UnauthorizedException) throw err;
      // Otros fallos: se traza y se responde 200 para no gatillar reentregas en bucle; el
      // ciclo de conciliación lo recupera después.
      this.logger.error(
        'Error procesando el webhook de PicPay',
        err instanceof Error ? err.stack : String(err),
      );
    }
    return { received: true };
  }
}
