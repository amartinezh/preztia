/**
 * Fechas de NEGOCIO legibles en el idioma del operador, construidas sobre los formateadores del
 * design system (`formatDate`, `formatShortDate`, `formatDateTime` de `@preztiaos/ui`): una sola
 * tabla de meses y una sola regla de lectura de `YYYY-MM-DD` (local, sin corrimiento UTC). Aquí
 * solo viven los formatos que el diseño no necesita: el rango de un período y la fecha larga.
 */
// Import profundo deliberado: el índice de `ui` arrastra react-native y rompe las pruebas en node.
import { addDaysIso, formatDate, formatDateTime as formatInstant, formatShortDate, isValidIsoDate } from "@preztiaos/ui/src/format/date";

// Guion "en" rodeado de espacios: la convención tipográfica de un rango de fechas.
const RANGE_SEPARATOR = " – ";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` → `Date` local a medianoche; `null` si el texto no es una fecha de negocio. */
export function parseBusinessDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match || !isValidIsoDate(iso.slice(0, 10))) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Día y mes cortos: "8 nov". Si no es fecha, devuelve el texto tal cual. */
export function formatDayMonth(iso: string, locale: string): string {
  return formatShortDate(iso, locale);
}

/** Fecha completa en palabras: "8 de noviembre de 2026" (encabezados). */
export function formatLongDate(iso: string, locale: string): string {
  const date = parseBusinessDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Rango de un período cuyo FIN ES EXCLUSIVO (el primer día del período siguiente, como viaja en el
 * contrato de liquidaciones): "1 oct – 31 oct". Si cruza de año, cada extremo lleva el suyo
 * ("29 dic 2025 – 4 ene 2026"); si no es del año en curso, se añade el año una vez al final.
 */
export function formatPeriodRange(startIso: string, endExclusiveIso: string, locale: string, today = new Date()): string {
  if (!isValidIsoDate(startIso) || !isValidIsoDate(endExclusiveIso)) {
    return `${startIso}${RANGE_SEPARATOR}${endExclusiveIso}`;
  }
  const endIso = addDaysIso(endExclusiveIso, -1);
  const startYear = Number(startIso.slice(0, 4));
  const endYear = Number(endIso.slice(0, 4));
  if (startYear !== endYear) {
    return `${formatDate(startIso, locale)}${RANGE_SEPARATOR}${formatDate(endIso, locale)}`;
  }
  const range = `${formatShortDate(startIso, locale)}${RANGE_SEPARATOR}${formatShortDate(endIso, locale)}`;
  return startYear === today.getFullYear() ? range : `${range} ${startYear}`;
}

/** Instante de auditoría (ISO con zona) como fecha y hora cortas en el idioma del operador. */
export function formatDateTime(isoTimestamp: string, locale: string): string {
  return formatInstant(isoTimestamp, locale);
}
