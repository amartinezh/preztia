import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Role } from '@preztiaos/domain';
import { verifyToken } from './jwt';

/** Identidad de la sesión derivada del access token (nunca de input del cliente). */
export interface Session {
  readonly userId: string;
  readonly role: Role;
  readonly tenantId: string;
  readonly zonePaths: readonly string[];
}

/**
 * Extrae y verifica la sesión del header `Authorization: Bearer`. La identidad real es el
 * JWT firmado (el `JwtGuard` ya validó firma/expiración y, en el plano de datos, la
 * coincidencia de tenant). Lanza 401 si falta o es inválido.
 */
export function requireSession(authorization: string | undefined): Session {
  if (
    typeof authorization !== 'string' ||
    !authorization.startsWith('Bearer ')
  ) {
    throw new UnauthorizedException('Falta el token de acceso');
  }
  const claims = verifyToken(authorization.slice('Bearer '.length));
  if (!claims || claims.typ !== 'access') {
    throw new UnauthorizedException('Token inválido o expirado');
  }
  return {
    userId: claims.sub,
    role: claims.role as Role,
    tenantId: claims.tenantId,
    zonePaths: claims.zonePaths,
  };
}

/**
 * AuthZ por rol en la frontera: exige una sesión válida cuyo rol esté en `allowed`. 403 si
 * el rol no tiene permiso. Devuelve la sesión para auditar quién ejecuta la operación.
 */
export function requireRole(
  authorization: string | undefined,
  allowed: readonly Role[],
): Session {
  const session = requireSession(authorization);
  if (!allowed.includes(session.role)) {
    throw new ForbiddenException('Tu rol no tiene permiso para esta operación');
  }
  return session;
}
