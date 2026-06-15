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
});
