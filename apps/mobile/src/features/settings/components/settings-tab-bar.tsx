import { Pressable, ScrollView } from "react-native";
import { Text } from "@preztiaos/ui";

import type { SettingsSection } from "../hooks/use-permissions";
import type { SettingsTabDef } from "../settings.config";

type Props = {
  tabs: readonly SettingsTabDef[];
  activeId: SettingsSection;
  onSelect: (id: SettingsSection) => void;
};

/**
 * Barra de pestañas de Ajustes: pills horizontales con scroll. Solo presentación; recibe las tabs
 * YA filtradas por permisos. Marca la activa y delega la selección al contenedor (que persiste el
 * tab en la URL). Accesible (role=button + selected) y responsiva (móvil ↔ web).
 */
export function SettingsTabBar({ tabs, activeId, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 pb-1"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.id)}
            className={`min-h-[40px] justify-center rounded-full border px-4 ${
              active
                ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                : "border-zinc-200 dark:border-zinc-700"
            }`}
          >
            <Text variant="label" tone={active ? "primary" : "muted"}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
