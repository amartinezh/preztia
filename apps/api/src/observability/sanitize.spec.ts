import { sanitize } from './sanitize';

describe('sanitize', () => {
  it('enmascara campos sensibles (cualquier capitalización)', () => {
    expect(
      sanitize({ email: 'a@b.com', password: 'secreto', apiKey: 'k' }),
    ).toEqual({
      email: 'a@b.com',
      password: '***',
      apiKey: '***',
    });
  });

  it('recorre objetos anidados y arreglos', () => {
    expect(
      sanitize({ user: { token: 't', name: 'x' }, list: [{ secret: 's' }] }),
    ).toEqual({
      user: { token: '***', name: 'x' },
      list: [{ secret: '***' }],
    });
  });

  it('deja intactos los valores primitivos', () => {
    expect(sanitize(42)).toBe(42);
    expect(sanitize('hola')).toBe('hola');
    expect(sanitize(null)).toBe(null);
  });

  // Regresión (auditoría de seguridad): estos campos SÍ existen en los contratos y la lista
  // de nombres EXACTOS los dejaba pasar en claro al audit_log, que es append-only.
  it('enmascara las credenciales del canal de WhatsApp', () => {
    expect(
      sanitize({
        phoneNumberId: '123',
        accessToken: 'EAAG...',
        appSecret: 'abc123',
        verifyToken: 'mi-token',
      }),
    ).toEqual({
      phoneNumberId: '123',
      accessToken: '***',
      appSecret: '***',
      verifyToken: '***',
    });
  });

  it('enmascara el secreto de la cuenta bancaria', () => {
    expect(
      sanitize({ label: 'PicPay', clientId: 'x', clientSecret: 'shhh' }),
    ).toEqual({ label: 'PicPay', clientId: 'x', clientSecret: '***' });
  });

  it('enmascara variantes no previstas gracias a la coincidencia por subcadena', () => {
    expect(
      sanitize({
        webhookSecret: 's',
        aiApiKey: 'k',
        bankCredential: 'c',
        confirmationPassword: 'p',
      }),
    ).toEqual({
      webhookSecret: '***',
      aiApiKey: '***',
      bankCredential: '***',
      confirmationPassword: '***',
    });
  });
});
