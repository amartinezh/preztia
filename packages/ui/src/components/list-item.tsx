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

// Estilo base de la fila, compartido por la versión interactiva y la no interactiva.
const ROW =
  "flex-row items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

/**
 * Fila de listado accesible y consistente (créditos, pagos, zonas). Si no hay `onPress` se
 * renderiza como `View` (no como botón): en web `Pressable` es un `<button>`, y una fila no
 * interactiva con un botón/switch en `trailing` produciría `<button>` dentro de `<button>`.
 */
export function ListItem({ title, subtitle, trailing, onPress }: ListItemProps) {
  const content = (
    <>
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
    </>
  );

  if (!onPress) {
    return <View className={ROW}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`${ROW} active:opacity-70 web:transition-opacity`}
    >
      {content}
    </Pressable>
  );
}
