import { View } from "react-native";

/** Marcador de posición durante la carga (mejor percepción de rendimiento que un spinner). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800 ${className ?? "h-4 w-full"}`}
    />
  );
}
