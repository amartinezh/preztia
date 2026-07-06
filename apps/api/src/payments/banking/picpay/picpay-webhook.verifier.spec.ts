import { verifyPicPayWebhook } from './picpay-webhook.verifier';

const TOKEN = 'tok-picpay-123';

describe('verifyPicPayWebhook', () => {
  it('acepta el token exacto en Authorization', () => {
    expect(
      verifyPicPayWebhook({ authorizationHeader: TOKEN, expectedToken: TOKEN }),
    ).toBe(true);
  });

  it('acepta el token con prefijo Bearer (robustez)', () => {
    expect(
      verifyPicPayWebhook({
        authorizationHeader: `Bearer ${TOKEN}`,
        expectedToken: TOKEN,
      }),
    ).toBe(true);
  });

  it('rechaza un token incorrecto', () => {
    expect(
      verifyPicPayWebhook({
        authorizationHeader: 'tok-forjado',
        expectedToken: TOKEN,
      }),
    ).toBe(false);
  });

  it('rechaza cuando falta el header', () => {
    expect(
      verifyPicPayWebhook({
        authorizationHeader: undefined,
        expectedToken: TOKEN,
      }),
    ).toBe(false);
  });

  it('rechaza cuando el tenant no tiene token configurado', () => {
    expect(
      verifyPicPayWebhook({ authorizationHeader: TOKEN, expectedToken: '' }),
    ).toBe(false);
  });

  it('rechaza un token con longitud distinta (sin filtrar tiempo)', () => {
    expect(
      verifyPicPayWebhook({
        authorizationHeader: `${TOKEN}x`,
        expectedToken: TOKEN,
      }),
    ).toBe(false);
  });
});
