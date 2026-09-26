import { describe, it, expect } from "vitest";
import type { ScheduleFrequency } from "@preztiaos/domain";

import {
  GrantCreditHandler,
  type CreditRepository,
  type DisbursementFunding,
  type ScheduledInstallment,
} from "./grant-credit";

/** Repositorio en memoria que captura lo persistido para verificar la orquestación. */
class FakeCreditRepository implements CreditRepository {
  saved: {
    credit: Parameters<CreditRepository["save"]>[0];
    schedule: readonly ScheduledInstallment[];
    funding: DisbursementFunding;
    contact: { phone: string } | undefined;
  }[] = [];
  async save(
    credit: Parameters<CreditRepository["save"]>[0],
    schedule: readonly ScheduledInstallment[],
    funding: DisbursementFunding,
    contact?: { phone: string },
  ) {
    this.saved.push({ credit, schedule, funding, contact });
  }
}

const baseCommand = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  borrowerId: "22222222-2222-2222-2222-222222222222",
  zoneId: "33333333-3333-3333-3333-333333333333",
  principalMinor: 100_000,
  interestPct: 200, // 20% en base-mil
  installmentsCount: 20,
  currency: "COP",
  fundingCashBoxId: "55555555-5555-5555-5555-555555555555",
  grantedBy: "66666666-6666-6666-6666-666666666666",
};

describe("GrantCreditHandler", () => {
  it("persiste el vínculo al plan y la periodicidad cuando se otorga desde un plan", async () => {
    const repo = new FakeCreditRepository();
    const handler = new GrantCreditHandler(repo);

    const result = await handler.execute({
      ...baseCommand,
      paymentPlanId: "44444444-4444-4444-4444-444444444444",
      frequency: "WEEKLY" as ScheduleFrequency,
    });

    expect(result.installments).toBe(20);
    expect(repo.saved).toHaveLength(1);
    const { credit, schedule } = repo.saved[0]!;
    expect(credit.paymentPlanId).toBe("44444444-4444-4444-4444-444444444444");
    expect(credit.frequency).toBe("WEEKLY");
    // Invariante: una cuota por período del cronograma.
    expect(schedule).toHaveLength(20);
  });

  it("otorga sin plan (Personalizado) con periodicidad diaria por defecto", async () => {
    const repo = new FakeCreditRepository();
    const handler = new GrantCreditHandler(repo);

    await handler.execute(baseCommand);

    const { credit } = repo.saved[0]!;
    expect(credit.paymentPlanId).toBeNull();
    expect(credit.frequency).toBe("DAILY");
  });

  it("entrega al repositorio la caja de origen y quién otorga: otorgar es desembolsar", async () => {
    const repo = new FakeCreditRepository();
    const handler = new GrantCreditHandler(repo);

    await handler.execute(baseCommand);

    expect(repo.saved[0]!.funding).toEqual({
      cashBoxId: baseCommand.fundingCashBoxId,
      grantedBy: baseCommand.grantedBy,
    });
  });
});
