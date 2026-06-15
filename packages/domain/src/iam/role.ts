// Modelo de roles y capacidades del IAM. Dominio PURO: define QUÉ puede hacer cada
// rol, sin conocer HTTP, JWT ni base de datos. Es la FUENTE ÚNICA de autorización por
// rol; el backend (guards/handlers) y el cliente (menús) la espejan. La autoridad real
// la imponen el backend y RLS; esto solo describe el permiso.

/** Roles del sistema. SUPER_ADMIN vive en el plano de control (cruza tenants). */
export type Role = "SUPER_ADMIN" | "ADMIN" | "COORDINATOR" | "COLLECTOR";

export const ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "COORDINATOR", "COLLECTOR"];

/**
 * Capacidades atómicas. `*:manage` agrupa el CRUD del recurso; los permisos operativos
 * (créditos/pagos/revisión) ya existían en el cliente y se conservan aquí como fuente.
 */
export type Permission =
  // Plano de control (solo SUPER_ADMIN)
  | "tenant:manage"
  | "tenant-admin:manage"
  // Administración del tenant (ADMIN)
  | "user:manage"
  | "zone:manage"
  // Operación de cobranza por zonas
  | "collector:manage"
  | "client:assign"
  | "client:read"
  // Operativo (espejo del authorization.ts del cliente)
  | "credit:create"
  | "credit:read"
  | "payment:register"
  | "payment:reconcile"
  | "application:review";

// Matriz rol → capacidades. SUPER_ADMIN gobierna la plataforma; ADMIN gobierna su
// tenant; COORDINATOR opera su subárbol y crea cobradores; COLLECTOR solo ve y cobra
// los clientes que se le asignaron.
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(["tenant:manage", "tenant-admin:manage"]),
  ADMIN: new Set([
    "user:manage",
    "zone:manage",
    "collector:manage",
    "client:assign",
    "client:read",
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
    "credit:create",
    "credit:read",
    "payment:register",
    "payment:reconcile",
    "application:review",
  ]),
  COLLECTOR: new Set(["client:read", "credit:read", "payment:register"]),
};

/** ¿El rol tiene la capacidad? `null`/desconocido ⇒ no. */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** SUPER_ADMIN es el único rol del plano de control (sin tenant, cruza tenants). */
export function isControlPlane(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

// Jerarquía de provisión: quién puede CREAR a quién. El SUPER_ADMIN provisiona admins
// de tenant (plano de control); el ADMIN crea coordinadores y cobradores; el
// COORDINATOR solo crea cobradores. Nadie crea SUPER_ADMIN por API (se siembra).
const CREATABLE_ROLES: Record<Role, readonly Role[]> = {
  SUPER_ADMIN: ["ADMIN"],
  ADMIN: ["COORDINATOR", "COLLECTOR"],
  COORDINATOR: ["COLLECTOR"],
  COLLECTOR: [],
};

/** Roles que `actor` tiene permitido crear. */
export function creatableRoles(actor: Role): readonly Role[] {
  return CREATABLE_ROLES[actor];
}

/** ¿`actor` puede crear un usuario con rol `target`? */
export function canCreateRole(actor: Role, target: Role): boolean {
  return CREATABLE_ROLES[actor].includes(target);
}
