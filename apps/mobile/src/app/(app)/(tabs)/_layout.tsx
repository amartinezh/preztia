import { useColorScheme, View } from "react-native";
import { Tabs, TabList, TabSlot, TabTrigger } from "expo-router/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { semanticColors, useBreakpoint } from "@preztiaos/ui";

import { BrandMark } from "@/components/app-shell/brand-mark";
import { NavItem } from "@/components/app-shell/nav-item";
import { UserMenu } from "@/components/app-shell/user-menu";
import { useNavGroups } from "@/components/app-shell/use-nav-groups";

/**
 * Shell de navegación responsivo (reemplaza a `NativeTabs`, que se desbordaba en web con 11
 * pestañas). En `lg+` (web/tablet) la navegación va en una barra SUPERIOR con marca + menú de
 * usuario; en móvil va en tabs INFERIORES con un encabezado superior ligero. Usamos los Tabs
 * "headless" de expo-router/ui: `<TabList>` registra/renderiza las pestañas y cada `<TabTrigger
 * asChild>` delega su pintado al `NavItem`. La barra forma parte del flujo del layout, así que
 * el contenido ya no queda tapado.
 */
export default function TabsLayout() {
  const { isDesktop } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const colors = semanticColors[scheme === "dark" ? "dark" : "light"];
  const groups = useNavGroups();
  // La pestaña inicial es la primera del rol (p. ej. SUPER_ADMIN abre en "tenants", no en Cartera).
  const initialRouteName = groups[0]?.name;

  const triggers = groups.map((g) => (
    <TabTrigger key={g.name} name={g.name} href={g.href} asChild>
      <NavItem label={g.label} orientation={isDesktop ? "horizontal" : "vertical"} />
    </TabTrigger>
  ));

  if (isDesktop) {
    return (
      <Tabs options={{ initialRouteName }}>
        <TabList
          style={{
            alignItems: "center",
            justifyContent: "flex-start",
            gap: 4,
            paddingTop: insets.top,
            paddingHorizontal: 16,
            borderBottomWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <BrandMark />
          {/* Fragment: el escáner de triggers recorre fragments, pero NO Views arbitrarios. */}
          <>{triggers}</>
          <View style={{ marginLeft: "auto" }}>
            <UserMenu />
          </View>
        </TabList>
        <TabSlot style={{ flex: 1 }} />
      </Tabs>
    );
  }

  return (
    <Tabs options={{ initialRouteName }}>
      <View
        style={{
          paddingTop: insets.top,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <BrandMark />
        <UserMenu compact />
      </View>
      <TabSlot style={{ flex: 1 }} />
      <TabList
        style={{
          justifyContent: "space-around",
          paddingBottom: insets.bottom,
          borderTopWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {triggers}
      </TabList>
    </Tabs>
  );
}
