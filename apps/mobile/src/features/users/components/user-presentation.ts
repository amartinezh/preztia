import type { UserSummary } from "@preztiaos/contracts";

import type { MessageKey } from "@/core/i18n";

/** Nombre del rol para el operador (el `Record` sobre el enum obliga a nombrar todo rol nuevo). */
export const ROLE_KEY: Record<UserSummary["role"], MessageKey> = {
  SUPER_ADMIN: "users.role.superAdmin",
  ADMIN: "users.role.admin",
  COORDINATOR: "users.role.coordinator",
  COLLECTOR: "users.role.collector",
};

/** Nombre visible de un usuario: su nombre si lo tiene configurado; si no, el correo. */
export function userLabel(user: Pick<UserSummary, "displayName" | "email">): string {
  return user.displayName ?? user.email;
}
