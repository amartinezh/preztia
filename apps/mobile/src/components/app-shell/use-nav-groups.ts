import type { Href } from "expo-router";

import { can } from "@/core/auth/authorization";
import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";

export type NavGroup = {
  /** Nombre de la ruta (archivo en `(tabs)/`) que registra la pestaña. */
  name: string;
  href: Href;
  label: string;
};

/**
 * Grupos del menú según el rol. Reduce las ~11 pestañas del legado a ≤5 grupos coherentes:
 * Cartera (créditos+cuentas), Revisión, Caja, Cuentas (clientes+pagos) y Ajustes. La autoridad
 * real la imponen backend + RLS; esto solo decide qué se ofrece.
 */
export function useNavGroups(): NavGroup[] {
  const { role } = useSession();
  const { t } = useT();

  if (role === "SUPER_ADMIN") {
    return [
      { name: "tenants", href: "/tenants" as Href, label: t("tenants.tab") },
      { name: "settings", href: "/settings" as Href, label: t("nav.settings") },
    ];
  }

  const groups: NavGroup[] = [];

  if (can(role, "credit:read")) {
    groups.push({ name: "index", href: "/" as Href, label: t("nav.cartera") });
  }
  if (can(role, "application:review")) {
    groups.push({ name: "applications", href: "/applications" as Href, label: t("review.tab") });
  }
  if (can(role, "cash:manage")) {
    groups.push({ name: "cash", href: "/cash" as Href, label: t("cash.tab") });
  }
  // Cuentas agrupa Clientes + Pagos (+ Cobradores/Operación según rol).
  if (
    can(role, "client:read") ||
    can(role, "borrower:manage") ||
    can(role, "payment:register") ||
    can(role, "payment:reconcile")
  ) {
    groups.push({ name: "cuentas", href: "/cuentas" as Href, label: t("nav.cuentas") });
  }
  groups.push({ name: "settings", href: "/settings" as Href, label: t("nav.settings") });

  return groups;
}
