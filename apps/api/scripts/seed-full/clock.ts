import {
  addDays,
  businessDateOf,
  localHourInstant,
  periodContaining,
} from '@preztiaos/domain';

// Reloj SIMULADO del seed. La historia se escribe día por día en la zona horaria de la empresa
// (la única fuente del "hoy" del sistema): cada hecho recibe un instante real dentro de su día de
// negocio, estrictamente creciente, para que los cortes (rendición, liquidación) y los órdenes
// por `created_at` queden exactamente como los dejaría la operación real.

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MINUTES_PER_DAY = 24 * 60;
// Margen respecto de "ahora" para los hechos de hoy: nunca se escribe un instante futuro.
const TODAY_SAFETY_MS = 2 * MS_PER_MINUTE;
// Hoy necesita al menos este tramo del día transcurrido para simular actividad sin apretujarla.
const MIN_ELAPSED_TODAY_MS = 30 * MS_PER_MINUTE;
const ISO_WEEKDAY_SUNDAY = 0;

export class BusinessClock {
  readonly today: string;

  constructor(
    readonly timeZone: string,
    readonly now: Date,
  ) {
    this.today = businessDateOf(now, timeZone);
  }

  /** Día de negocio desplazado `days` respecto de hoy (negativo = pasado). */
  daysFromToday(days: number): string {
    return addDays(this.today, days);
  }

  /** Lunes (inicio de la semana de liquidación) de la semana que contiene la fecha. */
  mondayOf(date: string): string {
    return periodContaining(
      { frequency: 'WEEKLY', anchorDay: 1, autoClose: true, startDate: null },
      date,
    ).start;
  }

  /** Instante de la hora local `hour:minute` del día de negocio. */
  at(date: string, hour: number, minute = 0): Date {
    return new Date(
      localHourInstant(date, hour, this.timeZone).getTime() +
        minute * MS_PER_MINUTE,
    );
  }

  isSunday(date: string): boolean {
    return this.isWeekday(date, ISO_WEEKDAY_SUNDAY);
  }

  /** ¿La fecha cae en ese día de la semana? (0 = domingo … 6 = sábado). */
  isWeekday(date: string, weekday: number): boolean {
    return new Date(`${date}T00:00:00Z`).getUTCDay() === weekday;
  }

  /** ¿Hoy ya transcurrió lo suficiente para escribir actividad del día? */
  canSimulateToday(): boolean {
    return (
      this.now.getTime() - this.at(this.today, 0).getTime() >=
      MIN_ELAPSED_TODAY_MS
    );
  }

  /** Línea de tiempo de un día: entrega instantes crecientes para cada hecho del día. */
  timeline(date: string): DayTimeline {
    return new DayTimeline(this, date);
  }

  /**
   * Instante de la hora local pedida SIN reservar la línea de tiempo del día: para hechos que no
   * tocan cajas (conversación, recorrido GPS). Hoy se comprime igual que la línea de tiempo.
   */
  instant(date: string, hour: number, minute = 0): Date {
    if (date !== this.today) return this.at(date, hour, minute);
    const start = this.at(date, 0).getTime() + MS_PER_MINUTE;
    const end = this.now.getTime() - TODAY_SAFETY_MS;
    const fraction = (hour * 60 + minute) / MINUTES_PER_DAY;
    return new Date(start + Math.floor((end - start) * fraction));
  }
}

/**
 * Instantes estrictamente crecientes dentro de un día de negocio. Los días pasados usan la hora
 * pedida; HOY se comprime proporcionalmente en el tramo [medianoche, ahora − margen] para que
 * ningún hecho quede en el futuro y el orden relativo se conserve.
 */
export class DayTimeline {
  private last = 0;

  constructor(
    private readonly clock: BusinessClock,
    readonly date: string,
  ) {}

  /** Instante para un hecho a la hora local `hour:minute`, siempre posterior al anterior. */
  at(hour: number, minute = 0): Date {
    const wanted = this.map(hour, minute).getTime();
    const instant = Math.max(wanted, this.last + MS_PER_SECOND);
    this.last = instant;
    return new Date(instant);
  }

  /** Instante inmediatamente posterior al último entregado (corte justo después de un asiento). */
  justAfter(): Date {
    this.last += 1;
    return new Date(this.last);
  }

  private map(hour: number, minute: number): Date {
    return this.clock.instant(this.date, hour, minute);
  }
}

/** Fechas de negocio de `from` a `to`, ambas inclusive. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}
