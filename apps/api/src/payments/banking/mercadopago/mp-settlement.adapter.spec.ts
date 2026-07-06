import { MercadoPagoSettlementAdapter } from './mp-settlement.adapter';
import type {
  MercadoPagoContext,
  MercadoPagoContextReader,
} from './mp-account-context.reader';
import type { SettlementReportFetcher } from './mp-report.client';
import type { SettlementWindow } from '@preztiaos/application';

const WINDOW: SettlementWindow = {
  tenantId: 't1',
  countryCode: 'BR',
  bankCode: 'MERCADOPAGO',
  begin: '2026-06-01T00:00:00Z',
  end: '2026-06-30T23:59:59Z',
};

const CONTEXT: MercadoPagoContext = {
  accessToken: 'APP_USR-token',
  reportConfig: null,
};

const HEADER =
  'SOURCE_ID,TRANSACTION_AMOUNT,SETTLEMENT_NET_AMOUNT,TRANSACTION_CURRENCY,PAYMENT_METHOD_TYPE,TRANSACTION_TYPE,SETTLEMENT_DATE';

function reader(ctx: MercadoPagoContext | null): MercadoPagoContextReader {
  return { read: () => Promise.resolve(ctx) };
}
function fetcher(csv: string | null): SettlementReportFetcher {
  return { fetchSettlementCsv: () => Promise.resolve(csv) };
}

describe('MercadoPagoSettlementAdapter', () => {
  it('parsea el CSV y devuelve solo los ingresos PIX reales (filtra tarjeta/refund/débito)', async () => {
    const csv = [
      HEADER,
      'PIX1,100.00,100.00,BRL,bank_transfer,payment,2026-06-10T00:00:00Z', // PIX válido
      'CARD1,200.00,200.00,BRL,credit_card,payment,2026-06-10T00:00:00Z', // tarjeta → fuera
      'REF1,-50.00,-50.00,BRL,bank_transfer,refund,2026-06-10T00:00:00Z', // refund → fuera
      'DEB1,30.00,0,BRL,bank_transfer,payment,2026-06-10T00:00:00Z', // neto 0 → fuera
    ].join('\n');
    const adapter = new MercadoPagoSettlementAdapter(
      reader(CONTEXT),
      fetcher(csv),
    );

    const credits = await adapter.fetchCredits(WINDOW);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.sourceId).toBe('PIX1');
    expect(credits[0]?.amountMinor).toBe(10000);
  });

  it('devuelve [] cuando no hay cuenta/credencial MP (reader null)', async () => {
    const adapter = new MercadoPagoSettlementAdapter(
      reader(null),
      fetcher(HEADER),
    );
    expect(await adapter.fetchCredits(WINDOW)).toEqual([]);
  });

  it('devuelve [] cuando el reporte no está disponible (fetcher null)', async () => {
    const adapter = new MercadoPagoSettlementAdapter(
      reader(CONTEXT),
      fetcher(null),
    );
    expect(await adapter.fetchCredits(WINDOW)).toEqual([]);
  });

  it('devuelve [] ante un reporte vacío (caso sandbox)', async () => {
    const adapter = new MercadoPagoSettlementAdapter(
      reader(CONTEXT),
      fetcher(HEADER),
    );
    expect(await adapter.fetchCredits(WINDOW)).toEqual([]);
  });

  it('degrada a [] si el reader lanza (no rompe la conciliación)', async () => {
    const throwingReader: MercadoPagoContextReader = {
      read: () => Promise.reject(new Error('db down')),
    };
    const adapter = new MercadoPagoSettlementAdapter(
      throwingReader,
      fetcher(HEADER),
    );
    expect(await adapter.fetchCredits(WINDOW)).toEqual([]);
  });
});
