import { hashPassword, verifyPassword } from './password';

describe('password scrypt', () => {
  it('verifica la contraseña correcta', async () => {
    const stored = await hashPassword('s3cr3t-pass');
    expect(await verifyPassword('s3cr3t-pass', stored)).toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const stored = await hashPassword('s3cr3t-pass');
    expect(await verifyPassword('otra', stored)).toBe(false);
  });

  it('usa sal aleatoria: dos hashes de la misma clave difieren', async () => {
    const a = await hashPassword('misma');
    const b = await hashPassword('misma');
    expect(a).not.toEqual(b);
    expect(await verifyPassword('misma', a)).toBe(true);
    expect(await verifyPassword('misma', b)).toBe(true);
  });

  it('rechaza un hash almacenado con formato inválido', async () => {
    expect(await verifyPassword('x', 'no-es-scrypt')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:solodos')).toBe(false);
  });
});
