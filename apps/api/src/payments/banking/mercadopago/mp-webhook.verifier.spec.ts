import { createHmac } from 'node:crypto';
import { verifyMercadoPagoWebhook } from './mp-webhook.verifier';

const SECRET = 'webhook-secret-123';
const DATA_ID = '999888777';
const REQUEST_ID = 'req-abc';
const TS = '1718900000000';

/** Construye una `x-signature` válida para los datos dados. */
function signatureHeader(
  secret: string,
  dataId: string,
  requestId: string,
  ts: string,
): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('verifyMercadoPagoWebhook (hmac-sha256)', () => {
  it('acepta una firma válida', () => {
    const header = signatureHeader(SECRET, DATA_ID, REQUEST_ID, TS);
    expect(
      verifyMercadoPagoWebhook({
        dataId: DATA_ID,
        requestId: REQUEST_ID,
        signatureHeader: header,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('rechaza con secreto incorrecto', () => {
    const header = signatureHeader(SECRET, DATA_ID, REQUEST_ID, TS);
    expect(
      verifyMercadoPagoWebhook({
        dataId: DATA_ID,
        requestId: REQUEST_ID,
        signatureHeader: header,
        secret: 'otro-secreto',
      }),
    ).toBe(false);
  });

  it('rechaza si el data.id fue manipulado (firma sobre id viejo)', () => {
    const header = signatureHeader(SECRET, DATA_ID, REQUEST_ID, TS);
    expect(
      verifyMercadoPagoWebhook({
        dataId: '111', // distinto al firmado
        requestId: REQUEST_ID,
        signatureHeader: header,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rechaza si cambia el request-id', () => {
    const header = signatureHeader(SECRET, DATA_ID, REQUEST_ID, TS);
    expect(
      verifyMercadoPagoWebhook({
        dataId: DATA_ID,
        requestId: 'req-otro',
        signatureHeader: header,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rechaza una cabecera ausente o malformada', () => {
    const base = { dataId: DATA_ID, requestId: REQUEST_ID, secret: SECRET };
    expect(
      verifyMercadoPagoWebhook({ ...base, signatureHeader: undefined }),
    ).toBe(false);
    expect(
      verifyMercadoPagoWebhook({ ...base, signatureHeader: 'no-format' }),
    ).toBe(false);
    expect(
      verifyMercadoPagoWebhook({ ...base, signatureHeader: 'ts=123' }),
    ).toBe(false); // sin v1
  });

  it('rechaza con secreto vacío', () => {
    const header = signatureHeader(SECRET, DATA_ID, REQUEST_ID, TS);
    expect(
      verifyMercadoPagoWebhook({
        dataId: DATA_ID,
        requestId: REQUEST_ID,
        signatureHeader: header,
        secret: '',
      }),
    ).toBe(false);
  });

  it('la estrategia legacy-bcrypt aún no está soportada (rechaza)', () => {
    const header = signatureHeader(SECRET, DATA_ID, REQUEST_ID, TS);
    expect(
      verifyMercadoPagoWebhook({
        dataId: DATA_ID,
        requestId: REQUEST_ID,
        signatureHeader: header,
        secret: SECRET,
        strategy: 'legacy-bcrypt',
      }),
    ).toBe(false);
  });
});
