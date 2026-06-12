import { DomainError, Money } from "../shared/money";

export interface Installment { seq: number; amountDueMinor: number; }

/** Periodicidad de cobro de las cuotas (espejo del enum `frequency` de BD). */
export type ScheduleFrequency = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export function buildSchedule(principal: Money, interestPctBaseThousand: number, n: number): Installment[] {
  const total = principal.applyInterest(interestPctBaseThousand);
  const base = Math.floor(total.amountMinor / n);
  const out: Installment[] = [];
  let acc = 0;
  for (let seq = 1; seq <= n; seq++) {
    const amount = seq === n ? total.amountMinor - acc : base; // ajuste de redondeo en la última
    acc += amount;
    out.push({ seq, amountDueMinor: amount });
  }
  return out; // suma exacta = total
}

const DAYS_PER_WEEK = 7;
const DAYS_PER_BIWEEK = 14;

/**
 * Fechas de vencimiento de las cuotas (ISO `YYYY-MM-DD`), una por cuota, a
 * partir del día siguiente al desembolso según la periodicidad. Aritmética en
 * UTC para que el resultado no dependa de la zona horaria del servidor.
 */
export function scheduleDueDates(startDate: string, frequency: ScheduleFrequency, n: number): string[] {
  if (n <= 0) throw new DomainError("El número de cuotas debe ser positivo");
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new DomainError("Fecha de inicio inválida");

  const out: string[] = [];
  for (let seq = 1; seq <= n; seq++) {
    const due = new Date(start);
    if (frequency === "MONTHLY") due.setUTCMonth(due.getUTCMonth() + seq);
    else if (frequency === "WEEKLY") due.setUTCDate(due.getUTCDate() + seq * DAYS_PER_WEEK);
    else if (frequency === "BIWEEKLY") due.setUTCDate(due.getUTCDate() + seq * DAYS_PER_BIWEEK);
    else due.setUTCDate(due.getUTCDate() + seq); // DAILY
    out.push(due.toISOString().slice(0, 10));
  }
  return out;
}
