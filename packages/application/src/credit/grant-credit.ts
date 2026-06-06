import { randomUUID } from "node:crypto";
import { Money, buildSchedule } from "@preztiaos/domain";

// Puerto de salida (interface). La infraestructura lo implementa.
export interface CreditRepository {
  save(credit: { id: string; tenantId: string; principalMinor: number; currency: string }): Promise<void>;
}

export interface GrantCreditCommand {
  tenantId: string; borrowerId: string; zoneId: string;
  principalMinor: number; interestPct: number; installmentsCount: number; currency: string;
}

export class GrantCreditHandler {
  constructor(private readonly credits: CreditRepository) {}
  async execute(cmd: GrantCreditCommand): Promise<{ id: string; installments: number }> {
    const principal = Money.of(cmd.principalMinor, cmd.currency);
    const schedule = buildSchedule(principal, cmd.interestPct, cmd.installmentsCount);
    const id = randomUUID();
    await this.credits.save({ id, tenantId: cmd.tenantId, principalMinor: cmd.principalMinor, currency: cmd.currency });
    return { id, installments: schedule.length };
  }
}
