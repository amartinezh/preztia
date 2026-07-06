import { UnauthorizedException } from '@nestjs/common';
import { IngestPicPayWebhookService } from './ingest-picpay-webhook.service';
import type { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import type { ProviderWebhookEventDrizzleRepository } from './provider-webhook-event.repository';
import type {
  PicPayWebhookContext,
  PicPayWebhookContextDrizzleReader,
} from './banking/picpay/picpay-webhook-context.reader';
import type { RunSettlementReconciliationService } from './run-settlement-reconciliation.service';
import type { PaymentChargeDrizzleRepository } from './charge/payment-charge.repository';

const TOKEN = 'tok-picpay-123';
const E2E = 'E12345678202606101200abcDEF01234';

const CTX: PicPayWebhookContext = {
  bankAccountId: 'acc-pp',
  webhookToken: TOKEN,
};

function paidBody() {
  return {
    type: 'PAYMENT',
    eventDate: '2026-07-01T12:00:00Z',
    id: 'wh-1',
    data: {
      status: 'PAID',
      amount: 25000,
      merchantChargeId: 'charge-1',
      transactions: [
        { paymentType: 'PIX', amount: 25000, pix: { endToEndId: E2E } },
      ],
    },
  };
}

function build(opts: { ctx: PicPayWebhookContext | null }) {
  const reader = {
    read: jest.fn().mockResolvedValue(opts.ctx),
  } as unknown as PicPayWebhookContextDrizzleReader;
  const recordOnce = jest.fn().mockResolvedValue({ recorded: true });
  const events = {
    recordOnce,
  } as unknown as ProviderWebhookEventDrizzleRepository;
  const ingestMany = jest.fn().mockResolvedValue({ ingested: 1 });
  const credits = {
    ingestMany,
  } as unknown as IncomingCreditDrizzleRepository;
  const execute = jest.fn().mockResolvedValue({
    processed: 1,
    confirmed: 1,
    pendingReview: 0,
    unconfirmed: 0,
  });
  const reconcile = {
    execute,
  } as unknown as RunSettlementReconciliationService;
  const markStatusByMerchantChargeId = jest.fn().mockResolvedValue(undefined);
  const charges = {
    markStatusByMerchantChargeId,
  } as unknown as PaymentChargeDrizzleRepository;
  const service = new IngestPicPayWebhookService(
    reader,
    events,
    credits,
    reconcile,
    charges,
  );
  return {
    service,
    recordOnce,
    ingestMany,
    execute,
    markStatusByMerchantChargeId,
  };
}

describe('IngestPicPayWebhookService', () => {
  it('rechaza (401) cuando no hay cuenta PicPay / token configurado', async () => {
    const { service, recordOnce } = build({ ctx: null });
    await expect(
      service.ingest({
        tenantId: 't1',
        authorizationHeader: TOKEN,
        eventTypeHeader: 'TransactionUpdateMessage',
        body: paidBody(),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(recordOnce).not.toHaveBeenCalled();
  });

  it('rechaza (401) un token incorrecto y NO registra ni ingiere nada', async () => {
    const { service, recordOnce, ingestMany } = build({ ctx: CTX });
    await expect(
      service.ingest({
        tenantId: 't1',
        authorizationHeader: 'tok-forjado',
        eventTypeHeader: undefined,
        body: paidBody(),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(recordOnce).not.toHaveBeenCalled();
    expect(ingestMany).not.toHaveBeenCalled();
  });

  it('un PAID auténtico se registra, se ingiere como crédito y concilia en vivo', async () => {
    const { service, recordOnce, ingestMany, execute } = build({ ctx: CTX });
    const result = await service.ingest({
      tenantId: 't1',
      authorizationHeader: TOKEN,
      eventTypeHeader: 'TransactionUpdateMessage',
      body: paidBody(),
    });

    expect(result).toEqual({ recorded: true, ingested: 1, confirmed: 1 });
    expect(recordOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        bankAccountId: 'acc-pp',
        providerType: 'PICPAY',
        eventId: 'wh-1',
        status: 'PAID',
      }),
    );
    expect(ingestMany).toHaveBeenCalledWith({
      tenantId: 't1',
      bankAccountId: 'acc-pp',
      credits: [expect.objectContaining({ sourceId: E2E, amountMinor: 25000 })],
    });
    // Conciliación en vivo SIN refetch de las fuentes (usa lo ya ingerido).
    expect(execute).toHaveBeenCalledWith({ tenantId: 't1', refresh: false });
  });

  it('un evento no pagado (CANCELED) queda en la bitácora pero no ingiere ni concilia', async () => {
    const { service, recordOnce, ingestMany, execute } = build({ ctx: CTX });
    const body = paidBody();
    body.data.status = 'CANCELED';
    const result = await service.ingest({
      tenantId: 't1',
      authorizationHeader: TOKEN,
      eventTypeHeader: undefined,
      body,
    });

    expect(result).toEqual({ recorded: true, ingested: 0, confirmed: 0 });
    expect(recordOnce).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CANCELED' }),
    );
    expect(ingestMany).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('un payload ininteligible auténtico se acepta sin registrar (no rompe reentregas)', async () => {
    const { service, recordOnce } = build({ ctx: CTX });
    const result = await service.ingest({
      tenantId: 't1',
      authorizationHeader: TOKEN,
      eventTypeHeader: undefined,
      body: { sin: 'identificadores' },
    });
    expect(result).toEqual({ recorded: false, ingested: 0, confirmed: 0 });
    expect(recordOnce).not.toHaveBeenCalled();
  });
});
