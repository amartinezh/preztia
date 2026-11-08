import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ConfirmModal, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { usePermissions, type SettingsSection } from "../hooks/use-permissions";
import { SETTINGS_TABS } from "../settings.config";
import { SettingsDirtyProvider, useSettingsDirtyState } from "./settings-dirty-context";
import { SettingsTabBar } from "./settings-tab-bar";

/**
 * Contenedor principal de Ajustes (req. #1 + #2). Responsabilidades:
 *  - RBAC de pestañas: solo renderiza las tabs cuyo `canView` es true para el rol actual.
 *  - Estado de la pestaña en la URL (`?tab=`): cambiar de tab no pierde el contexto y es
 *    enlazable/recargable; si la URL pide un tab no visible, cae al primero permitido.
 *  - Inyección del permiso de escritura: pasa `canEdit` al contenido del tab activo para que este
 *    bloquee inputs/botones cuando el rol solo tiene lectura.
 *  - Guarda de cambios sin guardar: los formularios con borrador se anotan en `SettingsDirtyProvider`;
 *    cambiar de pestaña con un borrador pide confirmar (descartar / seguir editando) y, en web, el
 *    navegador avisa antes de cerrar o recargar.
 *
 * Cada tab maneja su propio formulario y su propia mutación, así que "Guardar" envía únicamente el
 * payload de la pestaña activa (aislamiento por dominio).
 */
export function SettingsLayout() {
  return (
    <SettingsDirtyProvider>
      <SettingsLayoutBody />
    </SettingsDirtyProvider>
  );
}

function SettingsLayoutBody() {
  const { t } = useT();
  const perms = usePermissions();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { isDirty, clearAll } = useSettingsDirtyState();
  // Pestaña a la que se quiere ir mientras hay cambios sin guardar: espera la confirmación.
  const [pendingTab, setPendingTab] = useState<SettingsSection | null>(null);

  const visibleTabs = useMemo(
    () => SETTINGS_TABS.filter((tab) => perms.canView(tab.id)),
    [perms],
  );

  // Tab activo desde la URL; si no existe o no es visible para el rol, cae al primero permitido.
  const active = visibleTabs.find((tab) => tab.id === params.tab) ?? visibleTabs[0];

  if (!active) {
    return (
      <Screen>
        <Text tone="muted">{t("settings.noAccess")}</Text>
      </Screen>
    );
  }

  const goTo = (id: SettingsSection) => router.setParams({ tab: id });
  // Con un borrador abierto, cambiar de pestaña se confirma: el tab se desmonta y el borrador se pierde.
  const select = (id: SettingsSection) => {
    if (id === active.id) return;
    if (isDirty) {
      setPendingTab(id);
      return;
    }
    goTo(id);
  };
  const discardAndGo = () => {
    if (!pendingTab) return;
    clearAll();
    goTo(pendingTab);
    setPendingTab(null);
  };
  const ActiveTab = active.Component;

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("nav.settings")}</Text>
        <SettingsTabBar tabs={visibleTabs} activeId={active.id} onSelect={select} />
        <ActiveTab canEdit={perms.canEdit(active.id)} />
      </Stack>
      <ConfirmModal
        visible={pendingTab !== null}
        title={t("settings.dirty.title")}
        description={t("settings.dirty.body")}
        confirmLabel={t("settings.dirty.discard")}
        cancelLabel={t("settings.dirty.keep")}
        closeLabel={t("common.close")}
        tone="danger"
        onConfirm={discardAndGo}
        onCancel={() => setPendingTab(null)}
      />
    </Screen>
  );
}
