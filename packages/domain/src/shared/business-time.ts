// Tiempo de NEGOCIO por zona horaria del tenant (regla pura, sin librerías: usa Intl). El día de
// negocio y las horas límite ("rinde antes de las 20:00") son LOCALES del tenant; el sistema
// guarda instantes UTC. Aquí se traduce entre ambos, respetando horario de verano.

import { DomainError } from "./money";

const HOURS_PER_DAY = 24;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha de negocio (`YYYY-MM-DD`) de un instante en la zona horaria dada. */
export function businessDateOf(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Instante UTC en que es la hora `hourLocal`:00 del día de negocio `businessDate` en la zona.
 * Se corrige el desfase dos veces para caer bien en los días de cambio de horario.
 */
export function localHourInstant(businessDate: string, hourLocal: number, timeZone: string): Date {
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal >= HOURS_PER_DAY) {
    throw new DomainError("La hora local debe ser un entero entre 0 y 23");
  }
  const { year, month, day } = parseBusinessDate(businessDate);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hourLocal);
  let instant = wallClockAsUtc - offsetMs(new Date(wallClockAsUtc), timeZone);
  instant = wallClockAsUtc - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Suma días de calendario a una fecha de negocio. */
export function addDays(businessDate: string, days: number): string {
  const { year, month, day } = parseBusinessDate(businessDate);
  return new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function parseBusinessDate(businessDate: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(businessDate);
  if (!match) throw new DomainError("La fecha de negocio debe tener formato YYYY-MM-DD");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new DomainError("La fecha de negocio no existe en el calendario");
  }
  return { year, month, day };
}

/** Desfase (local − UTC) en ms de la zona en ese instante. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % HOURS_PER_DAY, p.minute, p.second);
  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new DomainError(`Zona horaria inválida: ${timeZone}`);
  }
  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
