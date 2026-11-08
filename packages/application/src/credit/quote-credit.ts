import { DEFAULT_SCHEDULE_FREQUENCY, type ScheduleFrequency } from "@preztiaos/domain";

import type { ScheduledInstallment } from "./grant-credit";
import { projectPlanSchedule } from "./plan/project-schedule";

export interface QuoteCreditInput {
  principalMinor: number;
  currency: string;
  /** Interés en base-mil (20,0 % → 200), la misma convención del otorgamiento. */
  interestPct: number;
  installmentsCount: number;
  /** Ausente ⇒ la periodicidad por defecto del otorgamiento. */
  frequency?: ScheduleFrequency;
  /** Fecha de desembolso (YYYY-MM-DD): las cuotas vencen a partir del período siguiente. */
  startDate: string;
}

export interface CreditQuote {
  currency: string;
  /** Valor de la cuota representativa (la primera); la última absorbe el redondeo. */
  installmentValueMinor: number;
  lastInstallmentMinor: number;
  totalDueMinor: number;
  interestMinor: number;
  firstDueDate: string;
  endDate: string;
  installments: ScheduledInstallment[];
}

/**
 * Cotiza el cronograma que vería el cliente ANTES de desembolsar, con la misma regla pura que lo
 * otorga (`projectPlanSchedule` = `buildSchedule` + `scheduleDueDates`): lo cotizado es exactamente
 * lo que se otorgaría con esos términos. Invariantes: Σ cuotas = total; interés = total − capital.
 * No persiste nada ni conoce I/O.
 */
export function quoteCredit(input: QuoteCreditInput): CreditQuote {
  const installments = projectPlanSchedule({
    principalMinor: input.principalMinor,
    currency: input.currency,
    plan: {
      installmentsCount: input.installmentsCount,
      frequency: input.frequency ?? DEFAULT_SCHEDULE_FREQUENCY,
      interestPct: input.interestPct,
    },
    startDate: input.startDate,
  });
  const totalDueMinor = installments.reduce((acc, i) => acc + i.amountDueMinor, 0);
  const first = installments[0]!;
  const last = installments[installments.length - 1]!;
  return {
    currency: input.currency,
    installmentValueMinor: first.amountDueMinor,
    lastInstallmentMinor: last.amountDueMinor,
    totalDueMinor,
    interestMinor: totalDueMinor - input.principalMinor,
    firstDueDate: first.dueDate,
    endDate: last.dueDate,
    installments,
  };
}
