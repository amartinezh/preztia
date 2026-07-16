import {
  normalizeAwesome,
  normalizeCoinGecko,
  normalizeSgs,
  normalizeTrm,
} from './market-normalizers';

describe('normalizeTrm', () => {
  it('devuelve null ante payloads basura (no lanza)', () => {
    expect(normalizeTrm(undefined)).toBeNull();
    expect(normalizeTrm({})).toBeNull();
    expect(normalizeTrm([])).toBeNull();
    expect(normalizeTrm([{ valor: 'no-es-numero' }])).toBeNull();
  });

  it('toma el valor más reciente, calcula la variación y ordena la serie de antiguo a nuevo', () => {
    const rows = [
      { valor: '4100.00', vigenciadesde: '2026-07-15T00:00:00.000' },
      { valor: '4000.00', vigenciadesde: '2026-07-14T00:00:00.000' },
      { valor: '3900.00', vigenciadesde: '2026-07-13T00:00:00.000' },
    ];
    const trm = normalizeTrm(rows);

    expect(trm).not.toBeNull();
    expect(trm?.id).toBe('usd-cop');
    expect(trm?.unit).toBe('COP');
    expect(trm?.value).toBe(4100);
    // Invariante: variación = (4100 - 4000) / 4000 = 2.5 %.
    expect(trm?.changePct).toBe(2.5);
    // Invariante: la serie va de más antiguo a más reciente (lista DESC del proveedor).
    expect(trm?.series).toEqual([3900, 4000, 4100]);
    expect(trm?.asOf).toBe('2026-07-15T00:00:00.000Z');
  });

  it('deja changePct en null si solo hay un punto', () => {
    const trm = normalizeTrm([{ valor: '4100', vigenciadesde: 'x' }]);
    expect(trm?.changePct).toBeNull();
    expect(trm?.asOf).toBeNull();
  });
});

describe('normalizeAwesome', () => {
  it('devuelve [] ante payloads basura (no lanza)', () => {
    expect(normalizeAwesome(null)).toEqual([]);
    expect(normalizeAwesome('x')).toEqual([]);
    expect(normalizeAwesome({ USDBRL: { bid: 'nada' } })).toEqual([]);
  });

  it('normaliza los pares conocidos e ignora los desconocidos', () => {
    const payload = {
      USDBRL: {
        bid: '5.4321',
        pctChange: '-0.12',
        create_date: '2026-07-15 17:00:00',
      },
      EURBRL: { bid: '5.90', pctChange: '0.30' },
      GBPBRL: { bid: '7.00', pctChange: '1' },
    };
    const indicators = normalizeAwesome(payload);

    expect(indicators.map((i) => i.id)).toEqual(['usd-brl', 'eur-brl']);
    expect(indicators[0].value).toBe(5.4321);
    expect(indicators[0].changePct).toBe(-0.12);
    expect(indicators[0].unit).toBe('BRL');
    expect(indicators[1].asOf).toBeNull();
  });

  it('omite un par cuyo bid no es numérico y conserva los demás', () => {
    const indicators = normalizeAwesome({
      USDBRL: { bid: '???' },
      EURBRL: { bid: '6.10', pctChange: '0.05' },
    });
    expect(indicators.map((i) => i.id)).toEqual(['eur-brl']);
  });
});

describe('normalizeSgs', () => {
  it('devuelve null ante payloads basura (no lanza)', () => {
    expect(normalizeSgs(undefined, 'selic', 'SELIC')).toBeNull();
    expect(normalizeSgs([], 'selic', 'SELIC')).toBeNull();
    expect(normalizeSgs([{ valor: 'x' }], 'selic', 'SELIC')).toBeNull();
  });

  it('ordena por fecha aunque el BCB entregue la serie descendente (orden no estable)', () => {
    const rows = [
      { data: '14/07/2026', valor: '14.15' },
      { data: '13/07/2026', valor: '14.10' },
    ];
    const cdi = normalizeSgs(rows, 'cdi', 'CDI');

    // Invariante: el "último" es el de fecha MAYOR, no el último del arreglo.
    expect(cdi?.value).toBe(14.15);
    expect(cdi?.asOf).toBe('2026-07-14T00:00:00.000Z');
    expect(cdi?.series).toEqual([14.1, 14.15]);
  });

  it('toma el último punto (serie ascendente del BCB) y convierte la fecha dd/MM/yyyy', () => {
    const rows = [
      { data: '01/06/2026', valor: '14.75' },
      { data: '01/07/2026', valor: '15.00' },
    ];
    const selic = normalizeSgs(rows, 'selic', 'Tasa SELIC');

    expect(selic?.value).toBe(15);
    expect(selic?.unit).toBe('%');
    // Invariante: variación = (15 - 14.75) / 14.75 ≈ 1.69 %.
    expect(selic?.changePct).toBe(1.69);
    expect(selic?.asOf).toBe('2026-07-01T00:00:00.000Z');
    expect(selic?.series).toEqual([14.75, 15]);
  });
});

describe('normalizeCoinGecko', () => {
  it('devuelve [] ante payloads basura (no lanza)', () => {
    expect(normalizeCoinGecko(null, null)).toEqual([]);
    expect(normalizeCoinGecko({ bitcoin: { usd: 'x' } }, null)).toEqual([]);
  });

  it('normaliza monedas conocidas con variación 24 h redondeada y el asOf del llamador', () => {
    const payload = {
      bitcoin: { usd: 120000.5, usd_24h_change: 1.23456 },
      ethereum: { usd: 4000 },
    };
    const indicators = normalizeCoinGecko(payload, '2026-07-15T12:00:00.000Z');

    expect(indicators.map((i) => i.id)).toEqual(['btc-usd', 'eth-usd']);
    expect(indicators[0].value).toBe(120000.5);
    expect(indicators[0].changePct).toBe(1.23);
    expect(indicators[0].asOf).toBe('2026-07-15T12:00:00.000Z');
    expect(indicators[1].changePct).toBeNull();
  });
});
