import { Switch as RNSwitch, View } from "react-native";
import { Text } from "../primitives/text";

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
};

/**
 * Interruptor on/off temático (activo/inactivo). Presentación pura sobre el `Switch` nativo
 * de react-native (funciona en iOS/Android/Web vía RN-Web), sin dependencias nuevas.
 */
export function Switch({ value, onValueChange, label, disabled }: SwitchProps) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      {label ? <Text variant="body">{label}</Text> : null}
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: "#d4d4d8", true: "#6366f1" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}
