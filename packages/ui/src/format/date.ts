/**
 * Fechas para PRESENTACIÓN y captura. El transporte usa ISO (`YYYY-MM-DD` para fechas de negocio,
 * datetime ISO para auditoría); estas funciones solo las vuelven legibles ("8 nov 2026") o leen lo
 * que teclea una persona. Nunca muestran "11-08": un mes y un día sueltos son ambiguos entre
 * regiones, por eso el mes siempre va con nombre.
 */

export type DateLocale = "es" | "pt-BR";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_LENGTH = 10;
const YEAR_DIGITS = 4;
const YEAR_MONTH_DIGITS = 6;
const MAX_DATE_DIGITS = 8;
const MINUTES_PAD = 2;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

// Abreviaturas fijas por idioma: deterministas en todo runtime (Hermes, navegador, Node), sin
// depender de los datos de `Intl` del dispositivo ("nov" vs "nov." según el motor).
const MONTHS_SHORT: Record<DateLocale, readonly string[]> = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  "pt-BR": ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
};

/** Reduce cualquier etiqueta de locale ("es-CO", "pt", "pt-BR") al diccionario disponible. */
function resolveLocale(locale: string | undefined): DateLocale {
  return locale?.toLowerCase().startsWith("pt") ? "pt-BR" : "es";
}

interface DateParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

/** Lee `YYYY-MM-DD` como componentes locales (sin pasar por `Date`, que lo tomaría como UTC). */
function parseIsoDate(isoDate: string): DateParts | null {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // `Date` normaliza desbordes (31 feb → 3 mar): comparar de vuelta detecta fechas inexistentes.
  const probe = new Date(year, month - 1, day);
  const real =
    probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
  return real ? { year, month, day } : null;
}

function toIso({ year, month, day }: DateParts): string {
  return `${String(year).padStart(YEAR_DIGITS, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localParts(date: Date): DateParts {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** true solo para una fecha `YYYY-MM-DD` que existe en el calendario. */
export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** Hoy en la fecha LOCAL del dispositivo (`YYYY-MM-DD`). Inyectable para pruebas. */
export function todayIso(now: Date = new Date()): string {
  return toIso(localParts(now));
}

/** Suma (o resta) días a una fecha `YYYY-MM-DD` sin tocar la hora ni la zona horaria. */
export function addDaysIso(isoDate: string, days: number): string {
  const parts = parseIsoDate(isoDate);
  if (!parts) return isoDate;
  return toIso(localParts(new Date(parts.year, parts.month - 1, parts.day + days)));
}

/**
 * Próximo día de la semana ESTRICTAMENTE después de `fromIso` (0 = domingo … 6 = sábado): si hoy
 * ya es ese día, devuelve el de la semana siguiente. Para chips como "Lunes" en una promesa de pago.
 */
export function nextWeekdayIso(fromIso: string, weekday: number): string {
  const parts = parseIsoDate(fromIso);
  if (!parts) return fromIso;
  const from = new Date(parts.year, parts.month - 1, parts.day);
  const delta = ((weekday - from.getDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK) || DAYS_PER_WEEK;
  return addDaysIso(fromIso, delta);
}

/** Días calendario enteros entre dos fechas `YYYY-MM-DD` (positivo si `to` es posterior). */
export function daysBetweenIso(fromIso: string, toIso_: string): number {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso_);
  if (!a || !b) return 0;
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * Máscara de captura: deja solo dígitos (máx. 8) e inserta los guiones de `AAAA-MM-DD` a medida
 * que se teclea. "20261108" → "2026-11-08"; "202611" → "2026-11". Idempotente sobre texto ya enmascarado.
 */
export function maskIsoDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, MAX_DATE_DIGITS);
  if (digits.length <= YEAR_DIGITS) return digits;
  if (digits.length <= YEAR_MONTH_DIGITS) return `${digits.slice(0, YEAR_DIGITS)}-${digits.slice(YEAR_DIGITS)}`;
  return `${digits.slice(0, YEAR_DIGITS)}-${digits.slice(YEAR_DIGITS, YEAR_MONTH_DIGITS)}-${digits.slice(YEAR_MONTH_DIGITS)}`;
}

/** ¿El texto ya tiene la longitud de una fecha completa? (para distinguir "a medio teclear"). */
export function isCompleteIsoDateText(text: string): boolean {
  return text.length === ISO_DATE_LENGTH;
}

function monthName(month: number, locale: string | undefined): string {
  return MONTHS_SHORT[resolveLocale(locale)][month - 1] ?? String(month);
}

/** "8 nov 2026" a partir de `YYYY-MM-DD`. Texto ilegible → se devuelve tal cual (nunca se inventa). */
export function formatDate(isoDate: string, locale?: string): string {
  const parts = parseIsoDate(isoDate.slice(0, ISO_DATE_LENGTH));
  if (!parts) return isoDate;
  return `${parts.day} ${monthName(parts.month, locale)} ${parts.year}`;
}

/** "8 nov" a partir de `YYYY-MM-DD` (celdas compactas: cronograma de cuotas). Nunca "11-08". */
export function formatShortDate(isoDate: string, locale?: string): string {
  const parts = parseIsoDate(isoDate.slice(0, ISO_DATE_LENGTH));
  if (!parts) return isoDate;
  return `${parts.day} ${monthName(parts.month, locale)}`;
}

interface DateTimeParts extends DateParts {
  hour: number;
  minute: number;
}

/** Componentes del instante en la zona horaria pedida; sin zona (o zona inválida) usa la local. */
function zonedParts(date: Date, timeZone: string | undefined): DateTimeParts {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(date);
      const read = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((p) => p.type === type)?.value ?? NaN);
      const result = {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        // Algunos motores devuelven "24" para medianoche con hour12:false.
        hour: read("hour") % 24,
        minute: read("minute"),
      };
      if (Object.values(result).every(Number.isFinite)) return result;
    } catch {
      // Zona desconocida para el runtime: degradación elegante a la hora local.
    }
  }
  return { ...localParts(date), hour: date.getHours(), minute: date.getMinutes() };
}

/**
 * "8 nov, 14:05" a partir de un datetime ISO. Si el año no es el actual se añade ("8 nov 2025,
 * 14:05") para que nunca sea ambiguo. `timeZone` (IANA, p. ej. la de la empresa) fija el reloj;
 * sin ella se usa la del dispositivo. Texto ilegible → se devuelve tal cual.
 */
export function formatDateTime(iso: string, locale?: string, timeZone?: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const p = zonedParts(date, timeZone);
  const sameYear = p.year === zonedParts(now, timeZone).year;
  const day = `${p.day} ${monthName(p.month, locale)}${sameYear ? "" : ` ${p.year}`}`;
  const time = `${String(p.hour).padStart(MINUTES_PAD, "0")}:${String(p.minute).padStart(MINUTES_PAD, "0")}`;
  return `${day}, ${time}`;
}
