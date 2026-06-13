import { createHmac, timingSafeEqual } from 'node:crypto';

// JWT HS256 (HMAC-SHA256) con node:crypto, sin dependencias externas. El secreto
// viene del entorno (JWT_SECRET, ya previsto en .env); jamás se hardcodea.
export type TokenType = 'access' | 'refresh';

export interface SessionClaims {
  /** Identificador del usuario (subject). */
  sub: string;
  tenantId: string;
  role: string;
  /** Subárbol(es) de zonas asignadas (paths ltree) para authZ de alcance. */
  zonePaths: string[];
  typ: TokenType;
  iat: number;
  exp: number;
}

const ACCESS_TTL_SECONDS = 15 * 60; // 15 min
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días
export const TOKEN_TTL = {
  access: ACCESS_TTL_SECONDS,
  refresh: REFRESH_TTL_SECONDS,
} as const;

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET no configurado');
  return value;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Firma un token con los claims dados y el TTL indicado (segundos). */
export function signToken(
  base: Pick<SessionClaims, 'sub' | 'tenantId' | 'role' | 'zonePaths' | 'typ'>,
  ttlSeconds: number,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = { ...base, iat, exp: iat + ttlSeconds };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = createHmac('sha256', secret())
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function isSessionClaims(value: unknown): value is SessionClaims {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sub === 'string' &&
    typeof v.tenantId === 'string' &&
    typeof v.role === 'string' &&
    Array.isArray(v.zonePaths) &&
    v.zonePaths.every((z) => typeof z === 'string') &&
    (v.typ === 'access' || v.typ === 'refresh') &&
    typeof v.exp === 'number'
  );
}

/** Verifica firma + expiración + forma de los claims. Devuelve null si es inválido. */
export function verifyToken(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac('sha256', secret())
    .update(`${header}.${body}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isSessionClaims(parsed)) return null;
  if (parsed.exp * 1000 <= Date.now()) return null;
  return parsed;
}
