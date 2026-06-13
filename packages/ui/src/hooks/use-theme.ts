import { useColorScheme } from "./use-color-scheme";
import { semanticColors, type ColorScheme } from "../tokens";

/** Devuelve la paleta semántica activa según el esquema del sistema. */
export function useTheme() {
  const scheme = useColorScheme();
  const active: ColorScheme = scheme === "dark" ? "dark" : "light";
  return { scheme: active, colors: semanticColors[active] };
}
