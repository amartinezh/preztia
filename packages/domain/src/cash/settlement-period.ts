// Regla PURA de los PERÍODOS de liquidación (sin I/O). Los períodos son de días de negocio del
// tenant (fechas YYYY-MM-DD en su zona horaria) y semiabiertos: [start, end).
//
// Invariantes:
// - un período contiene exactamente las fechas start ≤ d < end;
// - los períodos cerrados se encadenan: el siguiente empieza donde terminó el anterior (sin huecos
//   ni solapes), aunque la configuración cambie a mitad de camino.

import { DomainError } from "../shared/money";
import { addDays } from "../shared/business-time";

export type SettlementFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export interface SettlementSettings {
  readonly frequency: SettlementFrequency;
  /** Día de INICIO: 1–7 (lunes a domingo) en semanal; 1–28 en mensual; ignorado en quincenal. */
  readonly anchorDay: number;
  /** ¿El sistema cierra solo al pasar el corte? */
  readonly autoClose: boolean;
  /**
   * Día de negocio desde el que se liquida (YYYY-MM-DD). La historia anterior NO se reconstruye.
   * null = sin definir: el cierre automático no corre y un cierre manual reconstruye desde el
   * primer movimiento del libro.
   */
  readonly startDate: string | null;
}

export interface BusinessPeriod {
  readonly start: string;
  /** Exclusivo: el primer día del período siguiente. */
  readonly end: string;
}

export const DEFAULT_SETTLEMENT_SETTINGS: SettlementSettings = {
  frequency: "WEEKLY",
  anchorDay: 1,
  autoClose: true,
  startDate: null,
};

const DAYS_PER_WEEK = 7;
const MAX_WEEKDAY = 7;
// Hasta el 28 existe en todos los meses (febrero incluido): sin cortes que "se corran".
const MAX_MONTH_ANCHOR = 28;
const BIWEEKLY_SECOND_HALF = 16;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidSettlementSettings(s: SettlementSettings): void {
  if (s.startDate !== null && (!ISO_DATE.test(s.startDate) || addDays(s.startDate, 0) !== s.startDate)) {
    throw new DomainError("La fecha de inicio de la liquidación debe ser una fecha válida (AAAA-MM-DD)");
  }
  const max = s.frequency === "WEEKLY" ? MAX_WEEKDAY : MAX_MONTH_ANCHOR;
  if (s.frequency !== "BIWEEKLY" && (!Number.isInteger(s.anchorDay) || s.anchorDay < 1 || s.anchorDay > max)) {
    throw new DomainError(`El día de inicio del período debe estar entre 1 y ${max}`);
  }
}

/** Período (según la configuración) que contiene la fecha de negocio dada. */
export function periodContaining(settings: SettlementSettings, date: string): BusinessPeriod {
  assertValidSettlementSettings(settings);
  switch (settings.frequency) {
    case "WEEKLY": {
      const offset = (isoWeekday(date) - settings.anchorDay + DAYS_PER_WEEK) % DAYS_PER_WEEK;
      const start = addDays(date, -offset);
      return { start, end: addDays(start, DAYS_PER_WEEK) };
    }
    case "BIWEEKLY": {
      const { year, month, day } = parts(date);
      return day < BIWEEKLY_SECOND_HALF
        ? { start: ymd(year, month, 1), end: ymd(year, month, BIWEEKLY_SECOND_HALF) }
        : { start: ymd(year, month, BIWEEKLY_SECOND_HALF), end: firstOfNextMonth(year, month) };
    }
    case "MONTHLY": {
      const { year, month, day } = parts(date);
      const anchor = settings.anchorDay;
      const startMonth = day >= anchor ? { year, month } : shiftMonth(year, month, -1);
      const endMonth = shiftMonth(startMonth.year, startMonth.month, 1);
      return { start: ymd(startMonth.year, startMonth.month, anchor), end: ymd(endMonth.year, endMonth.month, anchor) };
    }
  }
}

/**
 * Siguiente período a cerrar: empieza donde terminó el último cerrado; si nunca se cerró, en la
 * fecha de inicio configurada (sin reconstruir lo anterior) o, sin ella, en el período del primer
 * movimiento del libro. Termina en el corte que marque la configuración vigente (un primer período
 * que arranca a mitad de semana/mes es parcial). null si no hay nada que liquidar.
 */
export function nextPeriodToClose(
  settings: SettlementSettings,
  input: { lastClosedEnd: string | null; firstActivityDate: string | null },
): BusinessPeriod | null {
  const start =
    input.lastClosedEnd ??
    settings.startDate ??
    (input.firstActivityDate ? periodContaining(settings, input.firstActivityDate).start : null);
  if (!start) return null;
  return { start, end: periodContaining(settings, start).end };
}

/** Período abierto en vivo: desde la última liquidación hasta el corte vigente que contiene hoy. */
export function currentOpenPeriod(
  settings: SettlementSettings,
  input: { lastClosedEnd: string | null; today: string },
): BusinessPeriod {
  const containing = periodContaining(settings, input.today);
  const configuredStart =
    settings.startDate !== null && settings.startDate <= input.today ? settings.startDate : null;
  return { start: input.lastClosedEnd ?? configuredStart ?? containing.start, end: containing.end };
}

/** ¿El sistema puede cerrar solo? Requiere cierre automático activo y fecha de inicio definida. */
export function canAutoClose(settings: SettlementSettings): boolean {
  return settings.autoClose && settings.startDate !== null;
}

/** ¿El período ya terminó (su corte llegó)? Solo un período terminado se puede cerrar. */
export function isPeriodEnded(period: BusinessPeriod, today: string): boolean {
  return period.end <= today;
}

/** Retroactivo = cerrado después de su día de corte (reconstrucción de historia). */
export function isRetroactive(period: BusinessPeriod, closedOn: string): boolean {
  return closedOn > period.end;
}

function isoWeekday(date: string): number {
  const { year, month, day } = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  return weekday === 0 ? MAX_WEEKDAY : weekday;
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function firstOfNextMonth(year: number, month: number): string {
  const next = shiftMonth(year, month, 1);
  return ymd(next.year, next.month, 1);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
