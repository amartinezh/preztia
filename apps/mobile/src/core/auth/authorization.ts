import type { SessionClaims, UserRole } from "./jwt";

/**
 * AuthZ del lado del cliente: decide qué se MUESTRA/HABILITA. No es la autoridad real
 * (esa la imponen el backend y RLS); solo evita ofrecer acciones que el backend negaría.
 */

export type Permission =
  | "credit:create"
  | "credit:read"
  | "payment:register"
  | "payment:reconcile"
  | "zone:manage";

// Capacidades por rol. ADMIN supervisa; COORDINATOR/COLLECTOR operan la ruta.
const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(["credit:create", "credit:read", "payment:register", "payment:reconcile", "zone:manage"]),
  COORDINATOR: new Set(["credit:create", "credit:read", "payment:register", "payment:reconcile"]),
  COLLECTOR: new Set(["credit:read", "payment:register"]),
};

export function can(role: UserRole | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Verifica que una zona (path ltree) cae dentro del subárbol asignado al usuario.
 * ADMIN no está acotado por zonas. Replica el criterio del futuro `ZoneScopeGuard` (§10).
 */
export function isZoneInScope(claims: SessionClaims | null, zonePath: string): boolean {
  if (!claims) return false;
  if (claims.role === "ADMIN") return true;
  return claims.zonePaths.some(
    (scope) => zonePath === scope || zonePath.startsWith(`${scope}.`),
  );
}
