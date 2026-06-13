import { View } from "react-native";
import { Text } from "../primitives/text";

export type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 dark:bg-zinc-800",
  success: "bg-emerald-100 dark:bg-emerald-950",
  danger: "bg-red-100 dark:bg-red-950",
  warning: "bg-amber-100 dark:bg-amber-950",
  info: "bg-brand-100 dark:bg-brand-950",
};

const TEXT_TONE: Record<BadgeTone, Parameters<typeof Text>[0]["tone"]> = {
  neutral: "muted",
  success: "success",
  danger: "danger",
  warning: "default",
  info: "primary",
};

/** Etiqueta de estado compacta (estado de crédito, cuota o pago). */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  return (
    <View className={`self-start rounded-full px-2.5 py-0.5 ${TONE[tone]}`}>
      <Text variant="caption" tone={TEXT_TONE[tone]} className="font-medium">
        {label}
      </Text>
    </View>
  );
}
