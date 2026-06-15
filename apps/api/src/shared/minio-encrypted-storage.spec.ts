import { randomBytes } from 'node:crypto';
import { decryptAtRest, encryptAtRest } from './minio-encrypted-storage';

// Llave AES-256 de prueba (32 bytes en base64), inyectada por entorno como en producción.
beforeAll(() => {
  process.env.KYC_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('cifrado en reposo del KYC', () => {
  it('descifra exactamente lo que cifró (round-trip)', () => {
    const original = Buffer.from('contenido binario del documento KYC ñ');
    const restored = decryptAtRest(encryptAtRest(original));
    expect(restored.equals(original)).toBe(true);
  });

  it('detecta manipulación del binario (tag GCM inválido)', () => {
    const sealed = encryptAtRest(Buffer.from('intacto'));
    sealed[sealed.length - 1] ^= 0xff; // altera el último byte del ciphertext
    expect(() => decryptAtRest(sealed)).toThrow();
  });
});
