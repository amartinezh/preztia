import type { SessionClaims, UserRole } from "./jwt";

/**
 * AuthZ del lado del cliente: decide qué se MUESTRA/HABILITA. No es la autoridad real
 * (esa la imponen el backend y RLS); solo evita ofrecer acciones que el backend negaría.
 */

// Espejo de `packages/domain/src/iam/role.ts` (fuente única). Si cambia el dominio, ajustar
// aquí. El plano de control (tenants/admins) es del SUPER_ADMIN; la administración del tenant
// (usuarios/zonas) del ADMIN; la operación por zonas del COORDINATOR; el COLLECTOR solo cobra.
export type Permission =
  | "tenant:manage"
  | "tenant-admin:manage"
  | "user:manage"
  | "zone:manage"
  | "collector:manage"
  | "client:assign"
  | "client:read"
  | "borrower:manage"
  | "cash:manage"
  | "cash:admin"
  | "credit:create"
  | "credit:read"
  | "payment:register"
  | "payment:reconcile"
  | "application:review";

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(["tenant:manage", "tenant-admin:manage"]),
  ADMIN: new Set([
    "user:manage",
    "zone:manage",
    "collector:manage",
    "client:assign",
    "client:read",
    "borrower:manage",
    "cash:manage",
    "cash:admin",
    "credit:create",
    "credit:read",
    "payment:register",
    "payment:reconcile",
    "application:review",
  ]),
  COORDINATOR: new Set([
    "collector:manage",
    "client:assign",
    "client:read",
    "borrower:manage",
    "cash:manage",
    "credit:create",
    "credit:read",
    "payment:register",
    "payment:reconcile",
    "application:review",
  ]),
  COLLECTOR: new Set(["client:read", "credit:read", "payment:register"]),
};

export function can(role: UserRole | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Verifica que una zona (path ltree) cae dentro del subárbol asignado al usuario.
 * ADMIN/SUPER_ADMIN no están acotados por zonas. Replica el criterio del `ZoneScopeGuard`.
 */
export function isZoneInScope(claims: SessionClaims | null, zonePath: string): boolean {
  if (!claims) return false;
  if (claims.role === "ADMIN" || claims.role === "SUPER_ADMIN") return true;
  return claims.zonePaths.some(
    (scope) => zonePath === scope || zonePath.startsWith(`${scope}.`),
  );
}
