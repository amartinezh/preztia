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
import { IngestSettlementWebhookService } from './ingest-settlement-webhook.service';

const uuid = z.string().uuid();

// Forma mínima del payload para extraer el id firmado; el resto se ignora (la verdad es el
// reporte que se descarga, no este aviso). Forma exacta pendiente de confirmar (VALIDATION).
const webhookBody = z.object({
  data: z.object({ id: z.union([z.string(), z.number()]) }).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  transaction_id: z.union([z.string(), z.number()]).optional(),
});

/**
 * Webhook de "reporte listo" de Mercado Pago. URL por tenant: la firma HMAC (con el secreto del
 * tenant) autentica el aviso, así que el tenantId del path no necesita ser secreto. Endpoint
 * público (sin JWT): la autenticidad la da la firma. Idempotente ante reentregas (la ingestión
 * deduplica por SOURCE_ID).
 */
@Controller('webhooks/mercadopago')
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(private readonly ingest: IngestSettlementWebhookService) {}

  @Post(':tenantId')
  @HttpCode(200)
  async receive(
    @Param('tenantId') tenantIdParam: string,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const tenant = uuid.safeParse(tenantIdParam);
    if (!tenant.success) {
      // tenantId malformado: se trata como aviso no autenticable.
      throw new UnauthorizedException('Webhook inválido');
    }

    try {
      await this.ingest.ingest({
        tenantId: tenant.data,
        dataId: extractDataId(body),
        requestId,
        signatureHeader: signature,
      });
    } catch (err) {
      // Firma inválida → 401 (no confirmamos un aviso forjado).
      if (err instanceof UnauthorizedException) throw err;
      // Otros fallos (ej. el reporte no estaba listo): se traza y se responde 200 para no
      // gatillar reentregas en bucle; el ciclo de conciliación lo recupera después.
      this.logger.error(
        'Error procesando el webhook de Mercado Pago',
        err instanceof Error ? err.stack : String(err),
      );
    }
    return { received: true };
  }
}

/** Extrae el `data.id` firmado del payload, de forma defensiva ante variantes de forma. */
function extractDataId(body: unknown): string {
  const parsed = webhookBody.safeParse(body);
  if (!parsed.success) return '';
  const raw =
    parsed.data.data?.id ?? parsed.data.transaction_id ?? parsed.data.id ?? '';
  return String(raw);
}
