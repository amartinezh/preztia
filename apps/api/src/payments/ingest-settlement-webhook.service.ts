import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  type SettlementSource,
  type SettlementWindow,
} from '@preztiaos/application';
import { SETTLEMENT_SOURCE } from './payments.tokens';
import { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import {
  verifyMercadoPagoWebhook,
  type WebhookSignatureStrategy,
} from './banking/mercadopago/mp-webhook.verifier';
import {
  type MercadoPagoWebhookContext,
  MercadoPagoWebhookContextDrizzleReader,
} from './banking/mercadopago/mp-webhook-context.reader';

const DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SettlementWebhookInput {
  readonly tenantId: string;
  readonly dataId: string;
  readonly requestId: string | undefined;
  readonly signatureHeader: string | undefined;
}

/**
 * Caso de uso del webhook "reporte listo" de Mercado Pago: valida la firma con el secreto del
 * tenant y, si es auténtica, trae los créditos de la ventana y los ingiere en `incoming_credit`
 * (idempotente por SOURCE_ID → una reentrega no duplica). La conciliación (match → confirmación)
 * la hace el ciclo de la Fase 2; este servicio solo puebla el ground truth.
 */
@Injectable()
export class IngestSettlementWebhookService {
  constructor(
    @Inject(SETTLEMENT_SOURCE) private readonly source: SettlementSource,
    private readonly credits: IncomingCreditDrizzleRepository,
    private readonly context: MercadoPagoWebhookContextDrizzleReader,
  ) {}

  async ingest(input: SettlementWebhookInput): Promise<{ ingested: number }> {
    const ctx = await this.context.read(input.tenantId);
    if (!ctx) {
      // Sin cuenta MP / sin secreto no se puede autenticar el webhook.
      throw new UnauthorizedException('Webhook de Mercado Pago no configurado');
    }
    const authentic = verifyMercadoPagoWebhook({
      dataId: input.dataId,
      requestId: input.requestId,
      signatureHeader: input.signatureHeader,
      secret: ctx.webhookSecret,
      strategy: signatureStrategy(),
    });
    if (!authentic) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const credits = await this.source.fetchCredits(
      windowFor(input.tenantId, ctx),
    );
    return this.credits.ingestMany({
      tenantId: input.tenantId,
      bankAccountId: ctx.bankAccountId,
      credits,
    });
  }
}

function windowFor(
  tenantId: string,
  ctx: MercadoPagoWebhookContext,
): SettlementWindow {
  const end = new Date();
  const days =
    ctx.windowDays && ctx.windowDays > 0 ? ctx.windowDays : DEFAULT_WINDOW_DAYS;
  const begin = new Date(end.getTime() - days * MS_PER_DAY);
  return {
    tenantId,
    countryCode: ctx.countryCode,
    bankCode: ctx.bankCode,
    begin: begin.toISOString(),
    end: end.toISOString(),
  };
}

function signatureStrategy(): WebhookSignatureStrategy {
  return process.env.MP_WEBHOOK_SIGNATURE_STRATEGY === 'legacy-bcrypt'
    ? 'legacy-bcrypt'
    : 'hmac-sha256';
}
