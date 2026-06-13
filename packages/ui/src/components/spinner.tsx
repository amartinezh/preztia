import { ActivityIndicator, View } from "react-native";
import { Text } from "../primitives/text";

/** Indicador de carga centrado, con mensaje accesible opcional. */
export function Spinner({ label }: { label?: string }) {
  return (
    <View className="items-center justify-center gap-3 p-6" accessibilityRole="progressbar">
      <ActivityIndicator />
      {label ? (
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}
