import { View } from "react-native";
import { Text } from "../primitives/text";

type Tone = "info" | "success" | "warning" | "danger";

const SURFACE: Record<Tone, string> = {
  info: "bg-brand-50 dark:bg-brand-950 border-brand-200 dark:border-brand-900",
  success: "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900",
  warning: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-900",
  danger: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900",
};

const TEXT: Record<Tone, Parameters<typeof Text>[0]["tone"]> = {
  info: "primary",
  success: "success",
  warning: "default",
  danger: "danger",
};

/**
 * Aviso contextual de ancho completo. Se usa para degradación elegante: modo offline,
 * un servicio externo caído, o el `correlationId` de un error para soporte.
 */
export function Banner({
  tone = "info",
  title,
  description,
}: {
  tone?: Tone;
  title: string;
  description?: string;
}) {
  return (
    <View className={`w-full rounded-xl border p-3 ${SURFACE[tone]}`} accessibilityRole="alert">
      <Text variant="label" tone={TEXT[tone]}>
        {title}
      </Text>
      {description ? (
        <Text variant="caption" tone="muted" className="mt-0.5">
          {description}
        </Text>
      ) : null}
    </View>
  );
}
