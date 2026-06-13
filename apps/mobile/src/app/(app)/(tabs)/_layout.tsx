import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useColorScheme } from "react-native";
import { semanticColors } from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";

/** Pestañas conscientes del rol: Pagos (conciliación) solo para quien puede conciliar. */
export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = semanticColors[scheme === "dark" ? "dark" : "light"];
  const { role } = useSession();
  const showPayments = can(role, "payment:reconcile");

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.surfaceMuted}
      labelStyle={{ selected: { color: colors.text } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Créditos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={require("@/assets/images/tabIcons/home.png")} renderingMode="template" />
      </NativeTabs.Trigger>

      {showPayments ? (
        <NativeTabs.Trigger name="payments">
          <NativeTabs.Trigger.Label>Pagos</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require("@/assets/images/tabIcons/explore.png")} renderingMode="template" />
        </NativeTabs.Trigger>
      ) : null}

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Ajustes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={require("@/assets/images/tabIcons/explore.png")} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
