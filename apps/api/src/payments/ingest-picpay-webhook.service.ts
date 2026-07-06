import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyPicPayWebhook } from './banking/picpay/picpay-webhook.verifier';
import { parsePicPayWebhook } from './banking/picpay/picpay-webhook.parser';
import { PicPayWebhookContextDrizzleReader } from './banking/picpay/picpay-webhook-context.reader';
import { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import { ProviderWebhookEventDrizzleRepository } from './provider-webhook-event.repository';
import { RunSettlementReconciliationService } from './run-settlement-reconciliation.service';
import { PaymentChargeDrizzleRepository } from './charge/payment-charge.repository';

export interface PicPayWebhookInput {
  readonly tenantId: string;
  readonly authorizationHeader: string | undefined;
  readonly eventTypeHeader: string | undefined;
  readonly body: unknown;
}

export interface PicPayWebhookResult {
  readonly recorded: boolean;
  readonly ingested: number;
  readonly confirmed: number;
}

/**
 * Caso de uso del webhook de PicPay: autentica la notificación con el token del tenant,
 * REGISTRA el evento crudo en la bitácora `provider_webhook_event` (todos los pagos quedan
 * trazados, también cancelaciones/expiraciones) y, si es un pago PAID, lo ingiere como crédito
 * real (`incoming_credit`, idempotente) y dispara la conciliación EN VIVO: los comprobantes de
 * WhatsApp pendientes se confirman contra el crédito recién llegado (match por E2E o monto).
 */
@Injectable()
export class IngestPicPayWebhookService {
  private readonly logger = new Logger('Payments:PicPayWebhook');

  constructor(
    private readonly context: PicPayWebhookContextDrizzleReader,
    private readonly events: ProviderWebhookEventDrizzleRepository,
    private readonly credits: IncomingCreditDrizzleRepository,
    private readonly reconcile: RunSettlementReconciliationService,
    private readonly charges: PaymentChargeDrizzleRepository,
  ) {}

  async ingest(input: PicPayWebhookInput): Promise<PicPayWebhookResult> {
    const ctx = await this.context.read(input.tenantId);
    if (!ctx) {
      // Sin cuenta PicPay / sin token no se puede autenticar la notificación.
      throw new UnauthorizedException('Webhook de PicPay no configurado');
    }
    const authentic = verifyPicPayWebhook({
      authorizationHeader: input.authorizationHeader,
      expectedToken: ctx.webhookToken,
    });
    if (!authentic) {
      throw new UnauthorizedException('Token de webhook inválido');
    }

    const event = parsePicPayWebhook(input.body, input.eventTypeHeader);
    if (!event) {
      // Auténtico pero ininteligible: se traza y se acepta (no gatillar reentregas en bucle).
      this.logger.warn(
        `Webhook de PicPay del tenant ${input.tenantId} con forma no reconocida; se ignora`,
      );
      return { recorded: false, ingested: 0, confirmed: 0 };
    }

    // 1) Bitácora de TODOS los webhooks (idempotente ante reentregas).
    const { recorded } = await this.events.recordOnce({
      tenantId: input.tenantId,
      bankAccountId: ctx.bankAccountId,
      providerType: 'PICPAY',
      eventId: event.eventId,
      eventType: event.eventType,
      status: event.status,
      payload: input.body,
    });

    // 1b) Refleja el estado en la cobrança conversacional (trazabilidad), si el evento la referencia.
    await this.updateChargeStatus(
      input.tenantId,
      event.merchantChargeId,
      event.status,
    );

    // 2) Solo un pago PAID puebla el ground truth y puede confirmar comprobantes.
    if (!event.credit) return { recorded, ingested: 0, confirmed: 0 };

    const { ingested } = await this.credits.ingestMany({
      tenantId: input.tenantId,
      bankAccountId: ctx.bankAccountId,
      credits: [event.credit],
    });

    // 3) Conciliación en vivo con lo ya ingerido (sin golpear las APIs de los proveedores).
    const summary = await this.reconcile.execute({
      tenantId: input.tenantId,
      refresh: false,
    });
    return { recorded, ingested, confirmed: summary.confirmed };
  }

  /** Mapea el estado del webhook a la cobrança (best-effort); ignora estados no terminales. */
  private async updateChargeStatus(
    tenantId: string,
    merchantChargeId: string | null,
    status: string | null,
  ): Promise<void> {
    if (!merchantChargeId) return;
    const mapped =
      status === 'PAID'
        ? 'PAID'
        : status === 'EXPIRED'
          ? 'EXPIRED'
          : status === 'CANCELED' || status === 'CANCELLED'
            ? 'CANCELED'
            : null;
    if (!mapped) return;
    await this.charges.markStatusByMerchantChargeId({
      tenantId,
      merchantChargeId,
      status: mapped,
    });
  }
}
