import type { DayTimeline } from './clock';

// AGENDA de un día simulado: cada planificador agrega acciones con su hora local y la agenda las
// ejecuta en orden cronológico. Así un PIX de las 10:00 queda antes que la rendición de las 19:00
// aunque se haya planificado después, y la línea de tiempo entrega instantes crecientes. Una acción
// puede agendar otras (p. ej. la revisión de un gasto a la tarde): entran en orden.

export type DayAction = (
  at: Date,
  timeline: DayTimeline,
) => Promise<void> | void;

interface Scheduled {
  readonly minuteOfDay: number;
  readonly order: number;
  readonly run: DayAction;
}

const MINUTES_PER_HOUR = 60;

export class DayPlan {
  private readonly pending: Scheduled[] = [];
  private sequence = 0;

  add(hour: number, minute: number, run: DayAction): void {
    this.pending.push({
      minuteOfDay: hour * MINUTES_PER_HOUR + minute,
      order: this.sequence++,
      run,
    });
  }

  async execute(timeline: DayTimeline): Promise<void> {
    while (this.pending.length > 0) {
      const next = this.takeEarliest();
      const hour = Math.floor(next.minuteOfDay / MINUTES_PER_HOUR);
      await next.run(
        timeline.at(hour, next.minuteOfDay % MINUTES_PER_HOUR),
        timeline,
      );
    }
  }

  private takeEarliest(): Scheduled {
    let best = 0;
    for (let i = 1; i < this.pending.length; i++) {
      const a = this.pending[i]!;
      const b = this.pending[best]!;
      if (
        a.minuteOfDay < b.minuteOfDay ||
        (a.minuteOfDay === b.minuteOfDay && a.order < b.order)
      )
        best = i;
    }
    return this.pending.splice(best, 1)[0]!;
  }
}
