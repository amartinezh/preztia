/**
 * Paleta vibrante del dashboard. Vive aparte para no repartir códigos de color por los
 * componentes (regla de código limpio: sin números mágicos). Tonos pensados para destacar
 * cada métrica: verde = aprobado/positivo, rojo/naranja = alerta/mora/fraude, azul/morado =
 * financiero. Funciona sobre fondos oscuros y claros.
 */
export const dashboardPalette = {
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  sky: "#0ea5e9",
  slate: "#64748b",
} as const;

export type DashboardAccent = (typeof dashboardPalette)[keyof typeof dashboardPalette];

/** Tinte translúcido del acento para fondos de tarjeta (sutil, no satura sobre oscuro/claro). */
export function tint(accent: string, alpha = 0.14): string {
  return `${accent}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
