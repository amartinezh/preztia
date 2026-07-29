import { Pressable, View } from "react-native";
import { Text } from "../primitives/text";

export type CheckboxProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Etiqueta accesible: obligatoria cuando no hay texto visible al lado. */
  accessibilityLabel: string;
  label?: string;
  disabled?: boolean;
};

/**
 * Casilla de selección para listados de selección múltiple (depuración de la bandeja, listas
 * de deudores). Presentación pura; el hit target mínimo es de 44px por accesibilidad táctil,
 * aunque la casilla dibujada sea más pequeña.
 */
export function Checkbox({
  value,
  onValueChange,
  accessibilityLabel,
  label,
  disabled,
}: CheckboxProps) {
  const box = value
    ? "border-brand-600 bg-brand-600"
    : "border-zinc-300 bg-transparent dark:border-zinc-600";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      className="min-h-[44px] min-w-[44px] flex-row items-center gap-2 disabled:opacity-40"
    >
      <View className={`h-5 w-5 items-center justify-center rounded border-2 ${box}`}>
        {value ? (
          <Text variant="caption" tone="inverse" className="font-bold leading-none">
            ✓
          </Text>
        ) : null}
      </View>
      {label ? <Text variant="label">{label}</Text> : null}
    </Pressable>
  );
}
