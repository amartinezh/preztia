import type { Href } from "expo-router";

import { can } from "@/core/auth/authorization";
import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";
import { hasVisibleSettingsSections } from "@/features/settings/hooks/use-permissions";

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
    const groups: NavGroup[] = [
      { name: "tenants", href: "/tenants" as Href, label: t("tenants.tab") },
    ];
    if (hasVisibleSettingsSections(role)) {
      groups.push({ name: "settings", href: "/settings" as Href, label: t("nav.settings") });
    }
    return groups;
  }

  const groups: NavGroup[] = [];

  // Panel de bienvenida: es la RUTA RAÍZ ("/" → index), por lo que es lo primero que se ve al
  // abrir la app y tras iniciar sesión. La autoridad fina la imponen backend + RLS; aquí solo
  // decidimos qué se ofrece.
  groups.push({ name: "index", href: "/" as Href, label: t("nav.inicio") });

  if (can(role, "credit:read")) {
    groups.push({ name: "cartera", href: "/cartera" as Href, label: t("nav.cartera") });
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
  // Ajustes solo se ofrece si el rol puede ver al menos una sección; si no (COLLECTOR),
  // la pestaña sería un callejón sin salida ("No tienes acceso a la configuración").
  if (hasVisibleSettingsSections(role)) {
    groups.push({ name: "settings", href: "/settings" as Href, label: t("nav.settings") });
  }

  return groups;
}
