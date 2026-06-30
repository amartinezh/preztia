import { parseAmountToMinor, parseSettlementCsv } from './mp-report-csv.parser';

const HEADER =
  'SOURCE_ID,TRANSACTION_AMOUNT,SETTLEMENT_NET_AMOUNT,TRANSACTION_CURRENCY,PAYMENT_METHOD_TYPE,TRANSACTION_TYPE,SETTLEMENT_DATE';

describe('parseAmountToMinor', () => {
  it('parsea punto decimal (en)', () => {
    expect(parseAmountToMinor('100.50', '.')).toBe(10050);
    expect(parseAmountToMinor('1,234.56', '.')).toBe(123456); // coma = miles
  });

  it('parsea coma decimal (pt/es)', () => {
    expect(parseAmountToMinor('100,50', ',')).toBe(10050);
    expect(parseAmountToMinor('1.234,56', ',')).toBe(123456); // punto = miles
  });

  it('maneja enteros sin decimales y negativos', () => {
    expect(parseAmountToMinor('1000', '.')).toBe(100000);
    expect(parseAmountToMinor('-50.00', '.')).toBe(-5000);
  });

  it('devuelve null si no hay dígitos', () => {
    expect(parseAmountToMinor('', '.')).toBeNull();
    expect(parseAmountToMinor('  ', '.')).toBeNull();
  });
});

describe('parseSettlementCsv', () => {
  it('parsea filas simples a NormalizedCredit', () => {
    const csv = [
      HEADER,
      'SRC1,100.50,100.50,BRL,bank_transfer,payment,2026-06-10T12:00:00.000Z',
    ].join('\n');
    const credits = parseSettlementCsv(csv);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toEqual({
      sourceId: 'SRC1',
      amountMinor: 10050,
      netAmountMinor: 10050,
      currency: 'BRL',
      paymentMethodType: 'bank_transfer',
      transactionType: 'payment',
      settlementDate: '2026-06-10T12:00:00.000Z',
    });
  });

  it('respeta comillas con comas internas y comillas escapadas', () => {
    const csv = [
      HEADER,
      'SRC2,"1,000.00","1,000.00",BRL,bank_transfer,"transfer, ""PIX""",2026-06-10T00:00:00Z',
    ].join('\n');
    const credits = parseSettlementCsv(csv);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.amountMinor).toBe(100000);
    expect(credits[0]?.transactionType).toBe('transfer, "PIX"');
  });

  it('maneja CRLF y un salto de línea final', () => {
    const csv = `${HEADER}\r\nSRC3,10.00,10.00,BRL,bank_transfer,payment,2026-06-10T00:00:00Z\r\n`;
    const credits = parseSettlementCsv(csv);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.sourceId).toBe('SRC3');
  });

  it('parsea débitos/refunds tal cual (el filtro de elegibilidad es del dominio)', () => {
    const csv = [
      HEADER,
      'SRC4,-25.00,-25.00,BRL,bank_transfer,refund,2026-06-10T00:00:00Z',
    ].join('\n');
    const credits = parseSettlementCsv(csv);
    expect(credits[0]?.netAmountMinor).toBe(-2500);
    expect(credits[0]?.transactionType).toBe('refund');
  });

  it('ignora filas sin SOURCE_ID', () => {
    const csv = [
      HEADER,
      ',10.00,10.00,BRL,bank_transfer,payment,2026-06-10T00:00:00Z',
      'SRC5,10.00,10.00,BRL,bank_transfer,payment,2026-06-10T00:00:00Z',
    ].join('\n');
    const credits = parseSettlementCsv(csv);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.sourceId).toBe('SRC5');
  });

  it('parsea con coma decimal cuando se configura (report_translation pt)', () => {
    const csv = [
      HEADER,
      'SRC6,"1.234,56","1.234,56",BRL,bank_transfer,payment,2026-06-10T00:00:00Z',
    ].join('\n');
    const credits = parseSettlementCsv(csv, { decimalSeparator: ',' });
    expect(credits[0]?.amountMinor).toBe(123456);
  });

  it('usa la moneda por defecto si la columna está vacía', () => {
    const csv = [
      HEADER,
      'SRC7,10.00,10.00,,bank_transfer,payment,2026-06-10T00:00:00Z',
    ].join('\n');
    const credits = parseSettlementCsv(csv, { defaultCurrency: 'BRL' });
    expect(credits[0]?.currency).toBe('BRL');
  });

  it('devuelve [] si falta la columna SOURCE_ID (reporte ilegible)', () => {
    const csv = ['AMOUNT,NET\n10.00,10.00'].join('\n');
    expect(parseSettlementCsv(csv)).toEqual([]);
  });

  it('devuelve [] para un reporte vacío (caso sandbox)', () => {
    expect(parseSettlementCsv('')).toEqual([]);
    expect(parseSettlementCsv(HEADER)).toEqual([]);
  });
});
