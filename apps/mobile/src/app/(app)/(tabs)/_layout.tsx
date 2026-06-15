import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useColorScheme } from "react-native";
import { semanticColors } from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { useT } from "@/core/i18n";

/**
 * Pestañas conscientes del rol. Cada rol ve SOLO su menú:
 * - SUPER_ADMIN → Tenants (plano de control).
 * - ADMIN → Créditos, Pagos, Revisión, Usuarios, Zonas.
 * - COORDINATOR → Créditos, Pagos, Revisión, Cobradores.
 * - COLLECTOR → Créditos, Mis clientes.
 * Ajustes para todos. La autoridad real la imponen el backend y RLS; esto solo decide qué se ofrece.
 */
export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = semanticColors[scheme === "dark" ? "dark" : "light"];
  const { role } = useSession();
  const { t } = useT();

  const primaryIcon = require("@/assets/images/tabIcons/home.png");
  const exploreIcon = require("@/assets/images/tabIcons/explore.png");

  const showCredits = can(role, "credit:read");
  const showPayments = can(role, "payment:reconcile");
  const showReview = can(role, "application:review");
  const isSuperAdmin = role === "SUPER_ADMIN";
  const showUsers = can(role, "user:manage");
  const showZones = can(role, "zone:manage");
  const isCoordinator = role === "COORDINATOR";
  const isCollector = role === "COLLECTOR";

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.surfaceMuted}
      labelStyle={{ selected: { color: colors.text } }}
    >
      {isSuperAdmin ? (
        <NativeTabs.Trigger name="tenants">
          <NativeTabs.Trigger.Label>{t("tenants.tab")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={primaryIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {showCredits ? (
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>{t("credit.list.title")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={primaryIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {isCollector ? (
        <NativeTabs.Trigger name="clients">
          <NativeTabs.Trigger.Label>{t("clients.tab")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {showPayments ? (
        <NativeTabs.Trigger name="payments">
          <NativeTabs.Trigger.Label>{t("payments.title")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {showReview ? (
        <NativeTabs.Trigger name="applications">
          <NativeTabs.Trigger.Label>{t("review.tab")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {isCoordinator ? (
        <NativeTabs.Trigger name="collectors">
          <NativeTabs.Trigger.Label>{t("collectors.tab")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {showUsers ? (
        <NativeTabs.Trigger name="users">
          <NativeTabs.Trigger.Label>{t("users.tab")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      {showZones ? (
        <NativeTabs.Trigger name="zones">
          <NativeTabs.Trigger.Label>{t("zones.tab")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Ajustes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={exploreIcon} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
