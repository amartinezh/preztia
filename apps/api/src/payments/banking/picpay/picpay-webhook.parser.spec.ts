import { parsePicPayWebhook } from './picpay-webhook.parser';

const E2E = 'E12345678202606101200abcDEF01234';

/** Payload representativo del `TransactionUpdateMessage` de PicPay (cobro PIX pagado). */
function paidPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'PAYMENT',
    eventDate: '2026-07-01T12:00:00Z',
    merchantDocument: '11222333000144',
    id: 'wh-1',
    data: {
      status: 'PAID',
      amount: 25000,
      merchantChargeId: 'charge-1',
      customer: { name: 'Fulano da Silva', document: '123.456.789-00' },
      transactions: [
        {
          paymentType: 'PIX',
          transactionStatus: 'PAID',
          amount: 25000,
          pix: { endToEndId: E2E },
        },
      ],
    },
    ...overrides,
  };
}

describe('parsePicPayWebhook', () => {
  it('normaliza un pago PAID a crédito PIX con endToEndId (centavos, bank_transfer)', () => {
    const event = parsePicPayWebhook(paidPayload(), 'TransactionUpdateMessage');
    expect(event).not.toBeNull();
    expect(event?.eventId).toBe('wh-1');
    expect(event?.eventType).toBe('TransactionUpdateMessage');
    expect(event?.status).toBe('PAID');
    expect(event?.credit).toEqual({
      sourceId: E2E,
      amountMinor: 25000,
      netAmountMinor: 25000,
      currency: 'BRL',
      paymentMethodType: 'bank_transfer',
      transactionType: 'payment',
      settlementDate: '2026-07-01T12:00:00Z',
      endToEndId: E2E,
    });
  });

  it('un evento no pagado (EXPIRED) se registra pero NO produce crédito', () => {
    const payload = paidPayload();
    (payload.data as { status: string }).status = 'EXPIRED';
    const event = parsePicPayWebhook(payload, undefined);
    expect(event?.status).toBe('EXPIRED');
    expect(event?.credit).toBeNull();
  });

  it('sin endToEndId usa el merchantChargeId como sourceId', () => {
    const payload = paidPayload();
    (payload.data as { transactions: unknown[] }).transactions = [
      { paymentType: 'PIX', amount: 25000 },
    ];
    const event = parsePicPayWebhook(payload, undefined);
    expect(event?.credit?.sourceId).toBe('charge-1');
    expect(event?.credit?.endToEndId).toBeNull();
  });

  it('monto inválido (cero, negativo o no entero) no produce crédito', () => {
    for (const amount of [0, -100, 25.5]) {
      const payload = paidPayload();
      (payload.data as { amount: number; transactions: unknown[] }).amount =
        amount;
      (payload.data as { transactions: unknown[] }).transactions = [
        { paymentType: 'PIX', amount },
      ];
      expect(parsePicPayWebhook(payload, undefined)?.credit).toBeNull();
    }
  });

  it('sin id de webhook deriva un eventId idempotente de cobro+estado', () => {
    const payload = paidPayload({ id: undefined });
    const event = parsePicPayWebhook(payload, undefined);
    expect(event?.eventId).toBe('charge-1:PAID');
  });

  it('payload ininteligible → null (se ignora sin romper)', () => {
    expect(parsePicPayWebhook('no-es-json-objeto', undefined)).toBeNull();
    expect(
      parsePicPayWebhook({ sin: 'identificadores' }, undefined),
    ).toBeNull();
  });

  it('sin transacción PIX usa el monto del nivel data (defensivo)', () => {
    const payload = paidPayload();
    (payload.data as { transactions?: unknown[] }).transactions = undefined;
    const event = parsePicPayWebhook(payload, undefined);
    expect(event?.credit?.amountMinor).toBe(25000);
    expect(event?.credit?.sourceId).toBe('charge-1');
  });
});
