import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { IngestSettlementWebhookService } from './ingest-settlement-webhook.service';
import type { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import type {
  MercadoPagoWebhookContext,
  MercadoPagoWebhookContextDrizzleReader,
} from './banking/mercadopago/mp-webhook-context.reader';
import type {
  SettlementSource,
  SettlementWindow,
} from '@preztiaos/application';
import type { NormalizedCredit } from '@preztiaos/domain';

const SECRET = 'wh-secret-xyz';
const DATA_ID = 'evt-1';
const REQUEST_ID = 'req-1';
const TS = '1718900000000';

const CTX: MercadoPagoWebhookContext = {
  bankAccountId: 'acc-1',
  countryCode: 'BR',
  bankCode: 'MERCADOPAGO',
  webhookSecret: SECRET,
  windowDays: 7,
};

function validSignature(secret = SECRET, dataId = DATA_ID): string {
  const manifest = `id:${dataId};request-id:${REQUEST_ID};ts:${TS};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${TS},v1=${v1}`;
}

function credit(sourceId: string): NormalizedCredit {
  return {
    sourceId,
    amountMinor: 1000,
    netAmountMinor: 1000,
    currency: 'BRL',
    paymentMethodType: 'bank_transfer',
    transactionType: 'payment',
    settlementDate: '2026-06-10T00:00:00Z',
  };
}

function build(opts: {
  ctx: MercadoPagoWebhookContext | null;
  credits?: readonly NormalizedCredit[];
  ingestMany?: jest.Mock;
}) {
  const reader = {
    read: jest.fn().mockResolvedValue(opts.ctx),
  } as unknown as MercadoPagoWebhookContextDrizzleReader;
  const fetchCredits = jest.fn().mockResolvedValue(opts.credits ?? []);
  const source = {
    fetchCredits,
  } as unknown as SettlementSource & { fetchCredits: jest.Mock };
  const ingestMany =
    opts.ingestMany ??
    jest.fn().mockResolvedValue({ ingested: opts.credits?.length ?? 0 });
  const repo = { ingestMany } as unknown as IncomingCreditDrizzleRepository & {
    ingestMany: jest.Mock;
  };
  const service = new IngestSettlementWebhookService(source, repo, reader);
  return { service, source, repo, reader };
}

describe('IngestSettlementWebhookService', () => {
  it('rechaza (401) cuando no hay cuenta MP / secreto configurado', async () => {
    const { service, source } = build({ ctx: null });
    await expect(
      service.ingest({
        tenantId: 't1',
        dataId: DATA_ID,
        requestId: REQUEST_ID,
        signatureHeader: validSignature(),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(source.fetchCredits).not.toHaveBeenCalled();
  });

  it('rechaza (401) firma inválida y NO ingiere nada', async () => {
    const { service, source, repo } = build({
      ctx: CTX,
      credits: [credit('S1')],
    });
    await expect(
      service.ingest({
        tenantId: 't1',
        dataId: DATA_ID,
        requestId: REQUEST_ID,
        signatureHeader: validSignature('otro-secreto'),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(source.fetchCredits).not.toHaveBeenCalled();
    expect(
      (repo as unknown as { ingestMany: jest.Mock }).ingestMany,
    ).not.toHaveBeenCalled();
  });

  it('con firma válida trae los créditos de la ventana y los ingiere', async () => {
    const { service, source, repo } = build({
      ctx: CTX,
      credits: [credit('S1')],
    });
    const result = await service.ingest({
      tenantId: 't1',
      dataId: DATA_ID,
      requestId: REQUEST_ID,
      signatureHeader: validSignature(),
    });
    expect(result).toEqual({ ingested: 1 });

    const fetchMock = source.fetchCredits;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [window] = fetchMock.mock.calls[0] as [SettlementWindow];
    expect(window.countryCode).toBe('BR');
    expect(window.bankCode).toBe('MERCADOPAGO');
    expect(new Date(window.begin).getTime()).toBeLessThan(
      new Date(window.end).getTime(),
    );
    expect(
      (repo as unknown as { ingestMany: jest.Mock }).ingestMany,
    ).toHaveBeenCalledWith({
      tenantId: 't1',
      bankAccountId: 'acc-1',
      credits: [credit('S1')],
    });
  });

  it('una reentrega es idempotente: la ingestión deduplica por SOURCE_ID (ingested 0)', async () => {
    // ingestMany simula el dedup real: la segunda vez no ingresa nada.
    const ingestMany = jest
      .fn()
      .mockResolvedValueOnce({ ingested: 1 })
      .mockResolvedValueOnce({ ingested: 0 });
    const { service } = build({
      ctx: CTX,
      credits: [credit('S1')],
      ingestMany,
    });
    const args = {
      tenantId: 't1',
      dataId: DATA_ID,
      requestId: REQUEST_ID,
      signatureHeader: validSignature(),
    };
    expect(await service.ingest(args)).toEqual({ ingested: 1 });
    expect(await service.ingest(args)).toEqual({ ingested: 0 });
  });
});
