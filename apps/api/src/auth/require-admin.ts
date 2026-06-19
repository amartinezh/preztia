import { requireRole, type Session } from './require-role';

// Solo el ADMIN del tenant gestiona cuentas bancarias y cajas (configuración financiera).
const ADMIN_ROLES = ['ADMIN'] as const;

/**
 * AuthZ por rol en la frontera de configuración de caja: exige rol ADMIN. La identidad real
 * es el JWT; devuelve la sesión para auditar quién ejecuta la operación. 403 si no es admin.
 */
export function requireAdmin(authorization: string | undefined): Session {
  return requireRole(authorization, ADMIN_ROLES);
}
