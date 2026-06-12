import { randomUUID } from "node:crypto";
import {
  Money,
  buildSchedule,
  scheduleDueDates,
  type Installment,
  type ScheduleFrequency,
} from "@preztiaos/domain";

/** Cuota del cronograma lista para persistir (plan + fecha de vencimiento). */
export interface ScheduledInstallment extends Installment {
  dueDate: string;
}

// Puerto de salida (interface). La infraestructura lo implementa: persiste el
// crédito, su cartera de cuotas y el contacto del deudor en UNA transacción.
export interface CreditRepository {
  save(
    credit: {
      id: string;
      tenantId: string;
      borrowerId: string;
      zoneId: string;
      principalMinor: number;
      interestPct: number;
      installmentsCount: number;
      frequency: ScheduleFrequency;
      currency: string;
      startDate: string;
      endDate: string;
    },
    schedule: readonly ScheduledInstallment[],
    contact?: { phone: string },
  ): Promise<void>;
}

export interface GrantCreditCommand {
  tenantId: string; borrowerId: string; zoneId: string;
  principalMinor: number; interestPct: number; installmentsCount: number; currency: string;
  frequency?: ScheduleFrequency;
  /** Teléfono WhatsApp del deudor (E.164 sin '+'): habilita abonos por PIX. */
  borrowerPhone?: string;
}

export class GrantCreditHandler {
  constructor(private readonly credits: CreditRepository) {}
  async execute(cmd: GrantCreditCommand): Promise<{ id: string; installments: number }> {
    const principal = Money.of(cmd.principalMinor, cmd.currency);
    const schedule = buildSchedule(principal, cmd.interestPct, cmd.installmentsCount);
    const frequency = cmd.frequency ?? "DAILY";
    const startDate = new Date().toISOString().slice(0, 10);
    const dueDates = scheduleDueDates(startDate, frequency, cmd.installmentsCount);
    const scheduled: ScheduledInstallment[] = schedule.map((installment, idx) => ({
      ...installment,
      dueDate: dueDates[idx]!,
    }));

    const id = randomUUID();
    await this.credits.save(
      {
        id,
        tenantId: cmd.tenantId,
        borrowerId: cmd.borrowerId,
        zoneId: cmd.zoneId,
        principalMinor: cmd.principalMinor,
        interestPct: cmd.interestPct,
        installmentsCount: cmd.installmentsCount,
        frequency,
        currency: cmd.currency,
        startDate,
        endDate: dueDates[dueDates.length - 1]!,
      },
      scheduled,
      cmd.borrowerPhone ? { phone: cmd.borrowerPhone } : undefined,
    );
    return { id, installments: schedule.length };
  }
}
