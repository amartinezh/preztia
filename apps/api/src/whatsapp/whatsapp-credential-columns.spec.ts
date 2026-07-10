// Clave de 32 bytes en base64 para AES-256 (determinista, solo para el test).
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

import { createHash } from 'node:crypto';
import { decryptSecret } from '../shared/secret-cipher';
import { toCredentialColumns } from './whatsapp-credential-columns';

describe('toCredentialColumns', () => {
  it('omite las columnas cuyos campos son undefined (no las toca)', () => {
    expect(toCredentialColumns({})).toEqual({});
    expect(toCredentialColumns({ graphVersion: 'v21.0' })).toEqual({
      graphVersion: 'v21.0',
    });
  });

  it('cifra el access token y el app secret (round-trip)', () => {
    const cols = toCredentialColumns({
      accessToken: 'EAAtoken',
      appSecret: 'app-secret-123',
    });
    expect(cols.accessToken).toMatch(/^enc:v1:/);
    expect(cols.appSecret).toMatch(/^enc:v1:/);
    expect(decryptSecret(cols.accessToken as string)).toBe('EAAtoken');
    expect(decryptSecret(cols.appSecret as string)).toBe('app-secret-123');
  });

  it('guarda el verify token como hash SHA-256 (nunca en claro)', () => {
    const cols = toCredentialColumns({ verifyToken: 'mi-verify-token' });
    expect(cols.verifyTokenSha256).toBe(
      createHash('sha256').update('mi-verify-token').digest('hex'),
    );
    expect(cols.verifyTokenSha256).not.toContain('mi-verify-token');
  });

  it('string vacío LIMPIA la credencial (null), presente pero sin valor', () => {
    expect(
      toCredentialColumns({
        accessToken: '',
        appSecret: '',
        verifyToken: '',
        graphVersion: '',
      }),
    ).toEqual({
      accessToken: null,
      appSecret: null,
      verifyTokenSha256: null,
      graphVersion: null,
    });
  });
});
