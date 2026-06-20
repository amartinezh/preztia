import { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { usePermissions, type SettingsSection } from "../hooks/use-permissions";
import { SETTINGS_TABS } from "../settings.config";
import { SettingsTabBar } from "./settings-tab-bar";

/**
 * Contenedor principal de Ajustes (req. #1 + #2). Responsabilidades:
 *  - RBAC de pestañas: solo renderiza las tabs cuyo `canView` es true para el rol actual.
 *  - Estado de la pestaña en la URL (`?tab=`): cambiar de tab no pierde el contexto y es
 *    enlazable/recargable; si la URL pide un tab no visible, cae al primero permitido.
 *  - Inyección del permiso de escritura: pasa `canEdit` al contenido del tab activo para que este
 *    bloquee inputs/botones cuando el rol solo tiene lectura.
 *
 * Cada tab maneja su propio formulario y su propia mutación, así que "Guardar" envía únicamente el
 * payload de la pestaña activa (aislamiento por dominio).
 */
export function SettingsLayout() {
  const { t } = useT();
  const perms = usePermissions();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();

  const visibleTabs = useMemo(
    () => SETTINGS_TABS.filter((tab) => perms.canView(tab.id)),
    [perms],
  );

  // Tab activo desde la URL; si no existe o no es visible para el rol, cae al primero permitido.
  const active = visibleTabs.find((tab) => tab.id === params.tab) ?? visibleTabs[0];

  if (!active) {
    return (
      <Screen>
        <Text tone="muted">No tienes acceso a la configuración.</Text>
      </Screen>
    );
  }

  const setActive = (id: SettingsSection) => router.setParams({ tab: id });
  const ActiveTab = active.Component;

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("nav.settings")}</Text>
        <SettingsTabBar tabs={visibleTabs} activeId={active.id} onSelect={setActive} />
        <ActiveTab canEdit={perms.canEdit(active.id)} />
      </Stack>
    </Screen>
  );
}
