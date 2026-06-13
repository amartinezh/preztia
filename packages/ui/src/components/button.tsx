import { ActivityIndicator, Pressable, type PressableProps, View } from "react-native";
import { Text } from "../primitives/text";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Ocupa todo el ancho disponible (útil en formularios móviles). */
  block?: boolean;
  className?: string;
};

const BASE =
  "flex-row items-center justify-center rounded-xl active:opacity-80 disabled:opacity-50 web:transition-opacity";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand-600",
  secondary: "bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700",
  ghost: "bg-transparent",
  danger: "bg-red-600",
};

const LABEL_TONE: Record<Variant, "inverse" | "default" | "primary"> = {
  primary: "inverse",
  secondary: "default",
  ghost: "primary",
  danger: "inverse",
};

// Alturas que garantizan hit targets ≥ 44px (accesibilidad táctil).
const SIZE: Record<Size, string> = {
  sm: "min-h-[44px] px-3 gap-2",
  md: "min-h-[48px] px-4 gap-2",
  lg: "min-h-[56px] px-6 gap-3",
};

/** Botón accesible con variantes, tamaños y estado de carga. */
export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${block ? "w-full" : ""} ${className ?? ""}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" || variant === "ghost" ? "#71717a" : "#ffffff"} />
      ) : (
        <View className="flex-row items-center gap-2">
          <Text variant="label" tone={LABEL_TONE[variant]} className="text-base">
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
