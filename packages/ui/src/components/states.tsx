import { type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "../primitives/text";
import { Button } from "./button";

type StateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: { label: string; onPress: () => void };
};

/** Estado vacío consistente para listados sin datos. */
export function EmptyState({ title, description, icon, action }: StateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      {icon}
      <Text variant="heading" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text tone="muted" className="text-center">
          {description}
        </Text>
      ) : null}
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}

/** Estado de error con acción de reintento (resiliencia / degradación elegante). */
export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8" accessibilityRole="alert">
      <Text variant="heading" tone="danger" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text tone="muted" className="text-center">
          {description}
        </Text>
      ) : null}
      {onRetry ? <Button label="Reintentar" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
