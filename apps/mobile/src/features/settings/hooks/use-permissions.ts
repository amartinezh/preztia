import { useMemo } from "react";

import { can } from "@/core/auth/authorization";
import type { UserRole } from "@/core/auth/jwt";
import { useSession } from "@/core/auth/session";

// Secciones (tabs) de Ajustes. Cada una declara su política de acceso de forma centralizada.
export type SettingsSection =
  | "general"
  | "collection"
  | "whatsapp"
  | "plans"
  | "bankAccounts"
  | "users";

/** Acceso por sección: `canView` controla si la pestaña se muestra; `canEdit`, si se puede modificar. */
export interface SectionAccess {
  readonly canView: boolean;
  readonly canEdit: boolean;
}

/**
 * Política RBAC de Ajustes en UN solo lugar (req. #3): traduce el rol del usuario a permisos de
 * lectura/escritura por sección, reusando el catálogo de permisos `can()` del cliente. La autoridad
 * REAL la imponen el backend + RLS; esto solo decide qué se ofrece y qué se bloquea en la UI.
 *
 * Lectura vs. escritura: el COORDINATOR ve "General" y "Cobranza" en SOLO LECTURA (el backend
 * permite el GET a revisores pero el PATCH exige ADMIN); las secciones sensibles (WhatsApp/IA,
 * Planes, Cuentas bancarias, Usuarios) ni siquiera aparecen para el Coordinador.
 */
function policyFor(role: UserRole | null): Record<SettingsSection, SectionAccess> {
  const isAdmin = role === "ADMIN";
  const isReviewer = can(role, "application:review"); // ADMIN o COORDINATOR
  const manageOrg = can(role, "user:manage") || can(role, "zone:manage");
  return {
    general: { canView: isReviewer, canEdit: isAdmin },
    collection: { canView: isReviewer, canEdit: isAdmin },
    whatsapp: { canView: isAdmin, canEdit: isAdmin },
    plans: { canView: isAdmin, canEdit: isAdmin },
    bankAccounts: { canView: can(role, "cash:admin"), canEdit: can(role, "cash:admin") },
    users: { canView: manageOrg, canEdit: manageOrg },
  };
}

/**
 * ¿El rol puede ver al menos una sección de Ajustes? Lo usa el shell de navegación para NO
 * ofrecer la pestaña a roles que aterrizarían en un "sin acceso" (COLLECTOR, SUPER_ADMIN).
 */
export function hasVisibleSettingsSections(role: UserRole | null): boolean {
  return Object.values(policyFor(role)).some((access) => access.canView);
}

/**
 * Custom hook de permisos de Ajustes: recibe (implícitamente) el rol de la sesión y expone
 * helpers para validar una sección/acción y obtener un booleano (`canView`/`canEdit`). Es la única
 * fuente de verdad de RBAC para los tabs y los controles de cada formulario.
 */
export function usePermissions() {
  const { role } = useSession();
  const policy = useMemo(() => policyFor(role), [role]);

  return useMemo(
    () => ({
      role,
      section: (section: SettingsSection): SectionAccess => policy[section],
      canView: (section: SettingsSection): boolean => policy[section].canView,
      canEdit: (section: SettingsSection): boolean => policy[section].canEdit,
    }),
    [role, policy],
  );
}
