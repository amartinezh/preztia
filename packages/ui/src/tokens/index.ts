import { Platform } from "react-native";

/**
 * Tokens de diseño: la ÚNICA fuente de estilo del sistema.
 *
 * Las clases de Tailwind/NativeWind cubren el 95% del estilado declarativo en JSX;
 * estos tokens existen para los casos donde se necesita el valor en JS (barras de
 * pestañas nativas, gráficos, animaciones) y para mantener Tailwind y JS sincronizados.
 * Sin números mágicos de color repartidos por la app (regla de código limpio, §3.2).
 */

/** Paleta de marca (indigo). El acento primario de PreztiaOS. */
export const brand = {
  50: "#eef2ff",
  100: "#e0e7ff",
  200: "#c7d2fe",
  300: "#a5b4fc",
  400: "#818cf8",
  500: "#6366f1",
  600: "#4f46e5",
  700: "#4338ca",
  800: "#3730a3",
  900: "#312e81",
} as const;

/** Colores semánticos por esquema. `semanticColors[scheme].<rol>`. */
export const semanticColors = {
  light: {
    background: "#ffffff",
    surface: "#ffffff",
    surfaceMuted: "#f4f4f5",
    border: "#e4e4e7",
    text: "#18181b",
    textMuted: "#52525b",
    textInverse: "#ffffff",
    primary: brand[600],
    primaryText: "#ffffff",
    success: "#059669",
    successSurface: "#ecfdf5",
    danger: "#dc2626",
    dangerSurface: "#fef2f2",
    warning: "#d97706",
    warningSurface: "#fffbeb",
  },
  dark: {
    background: "#09090b",
    surface: "#18181b",
    surfaceMuted: "#27272a",
    border: "#3f3f46",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    textInverse: "#18181b",
    primary: brand[500],
    primaryText: "#ffffff",
    success: "#34d399",
    successSurface: "#022c22",
    danger: "#f87171",
    dangerSurface: "#450a0a",
    warning: "#fbbf24",
    warningSurface: "#451a03",
  },
} as const;

export type ColorScheme = keyof typeof semanticColors;
export type SemanticColor = keyof typeof semanticColors.light;

/** Escala de espaciado (base 4). */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

/** Radios de borde. */
export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

/** Familias tipográficas (variables CSS en web, fuentes del sistema en nativo). */
export const fonts = Platform.select({
  ios: { sans: "system-ui", serif: "ui-serif", rounded: "ui-rounded", mono: "ui-monospace" },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
  default: { sans: "normal", serif: "serif", rounded: "normal", mono: "monospace" },
}) ?? { sans: "normal", serif: "serif", rounded: "normal", mono: "monospace" };

/** Ancho máximo de contenido en web (legibilidad en pantallas grandes). */
export const maxContentWidth = 880;

/**
 * Breakpoints (alineados con Tailwind por defecto). Se usan en `useBreakpoint`
 * para decisiones de layout que no se pueden expresar solo con clases `sm:`/`lg:`.
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type Breakpoint = keyof typeof breakpoints;
