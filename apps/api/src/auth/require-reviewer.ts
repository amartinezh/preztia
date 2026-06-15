import { requireRole, type Session } from './require-role';

// Roles autorizados a revisar expedientes y decidir manualmente (cartera).
// El COLLECTOR opera la ruta pero no aprueba créditos.
const REVIEWER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/** Identidad del coordinador/admin que decide (para el audit log). */
export type Reviewer = Session;

/**
 * AuthZ por rol en la frontera de la revisión de cartera: wrapper de `requireRole` con los
 * roles con permiso de revisión (ADMIN/COORDINATOR). La identidad real es el JWT; aquí se
 * extrae para auditar la decisión y se niega (403) a roles sin permiso.
 */
export function requireReviewer(authorization: string | undefined): Reviewer {
  return requireRole(authorization, REVIEWER_ROLES);
}
