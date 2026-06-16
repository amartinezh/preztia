import { Pressable, View, type PressableProps } from "react-native";
import { Text } from "@preztiaos/ui";

type Orientation = "horizontal" | "vertical";

export type NavItemProps = Omit<PressableProps, "children"> & {
  label: string;
  /** `horizontal` → píldora en la barra superior (web); `vertical` → ítem de tabs inferior (móvil). */
  orientation: Orientation;
  /** Inyectado por `<TabTrigger asChild>`: indica si esta pestaña está activa. */
  isFocused?: boolean;
};

/**
 * Botón de navegación del shell. Se usa como hijo de `<TabTrigger asChild>`, por lo que recibe
 * `isFocused` y `onPress` del router. No conoce rutas: solo presenta el estado activo.
 */
export function NavItem({ label, orientation, isFocused = false, ...pressable }: NavItemProps) {
  if (orientation === "horizontal") {
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        className={`min-h-[40px] items-center justify-center rounded-full px-4 web:transition-colors ${
          isFocused
            ? "bg-brand-50 dark:bg-zinc-800"
            : "active:bg-zinc-100 dark:active:bg-zinc-800"
        }`}
        {...pressable}
      >
        <Text variant="label" tone={isFocused ? "primary" : "muted"} className="text-[15px]">
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      className="min-h-[52px] flex-1 items-center justify-center gap-1 pt-1.5"
      {...pressable}
    >
      <View
        className={`h-0.5 w-8 rounded-full ${isFocused ? "bg-brand-600" : "bg-transparent"}`}
      />
      <Text
        variant="caption"
        tone={isFocused ? "primary" : "muted"}
        className={isFocused ? "font-semibold" : ""}
      >
        {label}
      </Text>
    </Pressable>
  );
}
