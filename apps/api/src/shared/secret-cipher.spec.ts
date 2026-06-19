// Clave de 32 bytes en base64 para AES-256 (determinista, solo para el test).
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

import {
  decryptOptionalSecret,
  decryptSecret,
  encryptOptionalSecret,
  encryptSecret,
} from './secret-cipher';

describe('secret-cipher', () => {
  it('cifra y descifra (round-trip) preservando el valor', () => {
    const secret = 'sk-live-abc123-credencial-bancaria';
    const enc = encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produce ciphertext distinto en cada cifrado (IV aleatorio)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('descifrar un valor SIN prefijo devuelve el texto plano legado sin tocar', () => {
    expect(decryptSecret('clave-en-claro-legada')).toBe(
      'clave-en-claro-legada',
    );
  });

  it('los helpers opcionales pasan null/undefined sin cifrar', () => {
    expect(encryptOptionalSecret(null)).toBeNull();
    expect(encryptOptionalSecret(undefined)).toBeNull();
    expect(encryptOptionalSecret('')).toBeNull();
    expect(decryptOptionalSecret(null)).toBeNull();
    const enc = encryptOptionalSecret('token');
    expect(decryptOptionalSecret(enc)).toBe('token');
  });

  it('un ciphertext manipulado falla la verificación GCM', () => {
    const enc = encryptSecret('secreto');
    const tampered = enc.slice(0, -3) + (enc.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
