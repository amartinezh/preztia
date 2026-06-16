import { View } from "react-native";
import { Text } from "@preztiaos/ui";

/** Marca de PreztiaOS en la barra de navegación (web/tablet). */
export function BrandMark() {
  return (
    <View className="mr-3 flex-row items-center">
      <View className="mr-2 h-7 w-7 items-center justify-center rounded-lg bg-brand-600">
        <Text variant="label" tone="inverse" className="text-base font-bold">
          P
        </Text>
      </View>
      <Text variant="heading" className="font-bold tracking-tight">
        Preztia
      </Text>
    </View>
  );
}
