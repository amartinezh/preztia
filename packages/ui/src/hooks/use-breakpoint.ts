import { useWindowDimensions } from "react-native";
import { breakpoints, type Breakpoint } from "../tokens";

const ORDER: Breakpoint[] = ["sm", "md", "lg", "xl"];

/**
 * Breakpoint activo para decisiones de layout que NO se pueden expresar solo con
 * clases responsivas (p. ej. elegir entre sidebar y bottom-tabs). Las diferencias
 * puramente visuales deben preferir las clases `sm:`/`lg:` de NativeWind.
 */
export function useBreakpoint() {
  const { width } = useWindowDimensions();

  let current: "base" | Breakpoint = "base";
  for (const bp of ORDER) {
    if (width >= breakpoints[bp]) current = bp;
  }

  return {
    width,
    breakpoint: current,
    isAtLeast: (bp: Breakpoint) => width >= breakpoints[bp],
    /** Conveniencia: en `lg+` mostramos layout de escritorio (sidebar). */
    isDesktop: width >= breakpoints.lg,
  };
}
