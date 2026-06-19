process.env.JWT_SECRET = 'test-secret-please-change';

import { signToken, verifyToken, TOKEN_TTL } from './jwt';

// Sin `as const`: `zonePaths` debe inferirse como `string[]` mutable (lo que espera
// `signToken`); los literales `typ`/`role` quedan tipados por el parámetro en cada llamada.
const base = {
  sub: 'u-1',
  tenantId: 't-1',
  role: 'COORDINATOR',
  zonePaths: ['co.bogota.suba'],
};

describe('jwt HS256', () => {
  it('firma y verifica un access token con sus claims', () => {
    const token = signToken({ ...base, typ: 'access' }, TOKEN_TTL.access);
    const claims = verifyToken(token);
    expect(claims).not.toBeNull();
    expect(claims).toMatchObject({ ...base, typ: 'access' });
    expect(claims!.exp).toBeGreaterThan(claims!.iat);
  });

  it('rechaza una firma manipulada', () => {
    const token = signToken({ ...base, typ: 'access' }, TOKEN_TTL.access);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rechaza un token expirado', () => {
    const token = signToken({ ...base, typ: 'access' }, -1);
    expect(verifyToken(token)).toBeNull();
  });

  it('rechaza un token con forma inválida', () => {
    expect(verifyToken('no.es.jwt')).toBeNull();
    expect(verifyToken('una-sola-parte')).toBeNull();
  });

  it('distingue access de refresh por el claim typ', () => {
    const refresh = signToken({ ...base, typ: 'refresh' }, TOKEN_TTL.refresh);
    expect(verifyToken(refresh)?.typ).toBe('refresh');
  });
});
