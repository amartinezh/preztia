import { View } from "react-native";
import type { ZoneNode } from "@preztiaos/contracts";
import { Checkbox, Stack, Text } from "@preztiaos/ui";

// Sangría por nivel del árbol de zonas (profundidad del path ltree).
const INDENT_PER_LEVEL = 16;

/**
 * Selección múltiple de zonas por casillas, en vez de teclear paths ltree a mano: muestra el árbol
 * con sangría y devuelve los `path` marcados, que es lo que el contrato de usuarios espera.
 * Presentación pura: las zonas las trae la pantalla.
 */
export function ZoneChecklist({
  zones,
  selectedPaths,
  onChange,
  disabled,
  emptyLabel,
}: {
  zones: readonly ZoneNode[];
  selectedPaths: readonly string[];
  onChange: (paths: string[]) => void;
  disabled?: boolean;
  emptyLabel: string;
}) {
  const toggle = (path: string, checked: boolean) =>
    onChange(checked ? [...selectedPaths, path] : selectedPaths.filter((p) => p !== path));

  if (zones.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        {emptyLabel}
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      {zones.map((zone) => {
        const depth = zone.path.split(".").length - 1;
        return (
          <View key={zone.id} style={{ paddingLeft: depth * INDENT_PER_LEVEL }}>
            <Checkbox
              value={selectedPaths.includes(zone.path)}
              onValueChange={(checked) => toggle(zone.path, checked)}
              accessibilityLabel={zone.name}
              label={zone.name}
              disabled={disabled}
            />
          </View>
        );
      })}
    </Stack>
  );
}
