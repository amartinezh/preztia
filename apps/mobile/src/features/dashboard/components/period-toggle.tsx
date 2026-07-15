import { Pressable, View } from "react-native";
import { Text } from "@preztiaos/ui";

export interface PeriodOption<K extends string> {
  key: K;
  label: string;
}

interface PeriodToggleProps<K extends string> {
  options: readonly PeriodOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Color de acento del segmento activo. */
  accent: string;
  textColor: string;
  mutedColor: string;
  /** Fondo del riel (surfaceMuted del tema). */
  trackColor: string;
}

/**
 * Control segmentado para elegir la ventana temporal (hoy / semana / mes / año). Componente
 * puramente visual: recibe opciones y estado por props, sin conocer dominio ni fetch. El
 * segmento activo se pinta con el color de acento; los demás quedan translúcidos sobre el riel.
 */
export function PeriodToggle<K extends string>({
  options,
  value,
  onChange,
  accent,
  textColor,
  mutedColor,
  trackColor,
}: PeriodToggleProps<K>) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        padding: 4,
        borderRadius: 12,
        backgroundColor: trackColor,
      }}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 9,
              alignItems: "center",
              backgroundColor: active ? accent : "transparent",
            }}
          >
            <Text
              variant="caption"
              style={{ color: active ? "#ffffff" : mutedColor, fontWeight: active ? "700" : "500" }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
