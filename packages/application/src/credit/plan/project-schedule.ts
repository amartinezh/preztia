import {
  Money,
  buildSchedule,
  scheduleDueDates,
  type PaymentPlan,
} from "@preztiaos/domain";

import type { ScheduledInstallment } from "../grant-credit";

/**
 * Proyecta el cronograma (fecha + monto de cada cuota) de un plan sobre un capital, reusando la
 * MISMA lógica pura del crédito (`buildSchedule` + `scheduleDueDates`). Es la fuente única tanto
 * para el mensaje de WhatsApp de la oferta como para crear el crédito al aceptar: garantiza que lo
 * prometido al cliente es exactamente lo que se otorga.
 */
export function projectPlanSchedule(input: {
  principalMinor: number;
  currency: string;
  plan: Pick<PaymentPlan, "installmentsCount" | "frequency" | "interestPct">;
  startDate: string;
}): ScheduledInstallment[] {
  const principal = Money.of(input.principalMinor, input.currency);
  const amounts = buildSchedule(principal, input.plan.interestPct, input.plan.installmentsCount);
  const dueDates = scheduleDueDates(input.startDate, input.plan.frequency, input.plan.installmentsCount);
  return amounts.map((installment, idx) => ({ ...installment, dueDate: dueDates[idx]! }));
}
