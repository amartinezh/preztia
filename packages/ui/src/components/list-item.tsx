import { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "../primitives/text";

export type ListItemProps = {
  title: string;
  subtitle?: string;
  /** Contenido a la derecha: importe, badge de estado, chevron, etc. */
  trailing?: ReactNode;
  onPress?: () => void;
};

/** Fila de listado accesible y consistente (créditos, pagos, zonas). */
export function ListItem({ title, subtitle, trailing, onPress }: ListItemProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 active:opacity-70 dark:border-zinc-800 dark:bg-zinc-900 web:transition-opacity"
    >
      <View className="flex-1 gap-0.5">
        <Text variant="label" className="text-base">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}
