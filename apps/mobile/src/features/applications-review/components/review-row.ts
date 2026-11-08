// Sin dependencias (ni de `@preztiaos/ui`): helper puro, probado en Node.
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
// Más allá de un mes, "hace N días" deja de ayudar a priorizar: se muestra la fecha.
const MAX_RELATIVE_DAYS = 30;

/** Antigüedad como descriptor puro; la pantalla lo traduce (`time.*`) o formatea la fecha. */
export type RelativeTime =
  | { kind: "now" }
  | { kind: "minutes"; n: number }
  | { kind: "hours"; n: number }
  | { kind: "yesterday" }
  | { kind: "days"; n: number }
  | { kind: "date"; at: Date }
  | { kind: "unreadable"; text: string };

/** Medianoche local del día de `d`: para contar días CALENDARIO, no bloques de 24 h. */
function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Antigüedad de un instante respecto a `now`: < 1 min → ahora; < 60 min → minutos; < 24 h → horas;
 * después por días CALENDARIO: 1 → ayer, 2–30 → "hace N días"; más antiguo (o un instante ilegible)
 * → la fecha, para no decir "hace 400 días". Un instante futuro cuenta como "ahora".
 */
export function relativeTime(iso: string, now: Date = new Date()): RelativeTime {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { kind: "unreadable", text: iso };
  const elapsedMinutes = Math.floor((now.getTime() - at.getTime()) / MS_PER_MINUTE);
  if (elapsedMinutes < 1) return { kind: "now" };
  if (elapsedMinutes < MINUTES_PER_HOUR) return { kind: "minutes", n: elapsedMinutes };
  const elapsedHours = Math.floor(elapsedMinutes / MINUTES_PER_HOUR);
  if (elapsedHours < HOURS_PER_DAY) return { kind: "hours", n: elapsedHours };
  const days = Math.round((localMidnight(now) - localMidnight(at)) / MS_PER_DAY);
  if (days <= 1) return { kind: "yesterday" };
  if (days <= MAX_RELATIVE_DAYS) return { kind: "days", n: days };
  return { kind: "date", at };
}

/**
 * Nombre legible de la zona a partir de su path ltree: el último segmento, con los guiones bajos
 * como espacios y la inicial en mayúscula ("bogota.centro_norte" → "Centro norte"). `null` sin path.
 */
export function zoneLeafName(zonePath: string | null | undefined): string | null {
  if (!zonePath) return null;
  const segments = zonePath.split(".").filter((s) => s.length > 0);
  const leaf = segments[segments.length - 1];
  if (!leaf) return null;
  const words = leaf.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
