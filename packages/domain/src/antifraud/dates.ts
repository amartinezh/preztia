// Utilidades mínimas de fechas para las reglas antifraude. El dominio recibe
// fechas ya normalizadas a ISO (YYYY-MM-DD) por la capa de aplicación; aquí solo
// se interpretan y comparan. Sin dependencias ni zonas horarias: fechas de negocio.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Interpreta una fecha ISO (YYYY-MM-DD); null si falta o no es interpretable. */
export function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Interpreta fecha-hora ISO completa (para metadata técnica); null si no es válida. */
export function parseIsoDateTime(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Días completos transcurridos entre dos fechas (positivo si `to` es posterior). */
export function differenceInDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Años completos entre dos fechas (edad). */
export function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversaryNotReached =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (anniversaryNotReached) years -= 1;
  return years;
}

/** Meses completos entre dos fechas. */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}
