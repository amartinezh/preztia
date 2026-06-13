import { Text as RNText, type TextProps as RNTextProps } from "react-native";

type Variant = "title" | "subtitle" | "heading" | "body" | "label" | "caption" | "code";
type Tone = "default" | "muted" | "primary" | "success" | "danger" | "inverse";

export type TextProps = RNTextProps & {
  variant?: Variant;
  tone?: Tone;
  className?: string;
};

// Una sola fuente para la escala tipográfica (sin tamaños mágicos sueltos por la app).
const VARIANT: Record<Variant, string> = {
  title: "text-4xl font-bold tracking-tight",
  subtitle: "text-2xl font-semibold tracking-tight",
  heading: "text-lg font-semibold",
  body: "text-base",
  label: "text-sm font-medium",
  caption: "text-xs",
  code: "font-mono text-xs",
};

const TONE: Record<Tone, string> = {
  default: "text-zinc-900 dark:text-zinc-50",
  muted: "text-zinc-500 dark:text-zinc-400",
  primary: "text-brand-600 dark:text-brand-400",
  success: "text-emerald-600 dark:text-emerald-400",
  danger: "text-red-600 dark:text-red-400",
  inverse: "text-white",
};

/** Texto temático y accesible. Toda la tipografía de la app pasa por aquí. */
export function Text({ variant = "body", tone = "default", className, ...rest }: TextProps) {
  return <RNText className={`${VARIANT[variant]} ${TONE[tone]} ${className ?? ""}`} {...rest} />;
}
