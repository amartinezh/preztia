import { describe, it, expect } from "vitest";
import { NotFoundError, type OperationalSettings, type PaymentPlan, type ScheduleFrequency } from "@preztiaos/domain";

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
  grantedByRole: "ADMIN" as const,
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

// ── Bloqueo del interés (antifraude): el interés solo sale de un plan activo ─────────────────────
const PLAN_ID = "44444444-4444-4444-4444-444444444444";
const PLAN_20: PaymentPlan = {
  id: PLAN_ID,
  tenantId: baseCommand.tenantId,
  name: "Diario 20",
  installmentsCount: 20,
  frequency: "DAILY",
  interestPct: 200,
  isActive: true,
  isDefault: true,
};

function guard(policy: { blockInterestChange: boolean; adminCustomInterestAllowed: boolean }, plan: PaymentPlan | null = PLAN_20) {
  return {
    settings: { get: async () => policy as OperationalSettings, save: async () => {} },
    plans: { findById: async () => plan } as unknown as import("./plan/ports").PaymentPlanStore,
  };
}
const LOCKED = { blockInterestChange: true, adminCustomInterestAllowed: true };

describe("GrantCreditHandler — bloqueo del interés", () => {
  it("con el interés exacto del plan activo, el coordinador otorga", async () => {
    const repo = new FakeCreditRepository();
    await new GrantCreditHandler(repo, undefined, guard(LOCKED)).execute({
      ...baseCommand,
      grantedByRole: "COORDINATOR",
      paymentPlanId: PLAN_ID,
    });
    expect(repo.saved).toHaveLength(1);
  });

  it("un coordinador que altera el interés del plan: 409 INTEREST_LOCKED y nada se desembolsa", async () => {
    const repo = new FakeCreditRepository();
    await expect(
      new GrantCreditHandler(repo, undefined, guard(LOCKED)).execute({
        ...baseCommand,
        grantedByRole: "COORDINATOR",
        paymentPlanId: PLAN_ID,
        interestPct: 150,
      }),
    ).rejects.toMatchObject({ code: "INTEREST_LOCKED" });
    expect(repo.saved).toHaveLength(0);
  });

  it("'Personalizado': el coordinador no; el ADMIN sí solo con la excepción permitida", async () => {
    const repo = new FakeCreditRepository();
    const custom = { ...baseCommand, interestPct: 350 };
    await expect(
      new GrantCreditHandler(repo, undefined, guard(LOCKED)).execute({ ...custom, grantedByRole: "COORDINATOR" }),
    ).rejects.toMatchObject({ code: "INTEREST_LOCKED" });
    await new GrantCreditHandler(repo, undefined, guard(LOCKED)).execute(custom);
    await expect(
      new GrantCreditHandler(repo, undefined, guard({ blockInterestChange: true, adminCustomInterestAllowed: false })).execute(custom),
    ).rejects.toMatchObject({ code: "INTEREST_LOCKED" });
    expect(repo.saved).toHaveLength(1);
  });

  it("un plan inexistente es 404: nunca se registra un crédito de un plan que no existe", async () => {
    const repo = new FakeCreditRepository();
    await expect(
      new GrantCreditHandler(repo, undefined, guard(LOCKED, null)).execute({ ...baseCommand, paymentPlanId: PLAN_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.saved).toHaveLength(0);
  });

  it("con el bloqueo apagado el interés es libre (comportamiento anterior)", async () => {
    const repo = new FakeCreditRepository();
    await new GrantCreditHandler(repo, undefined, guard({ blockInterestChange: false, adminCustomInterestAllowed: true })).execute({
      ...baseCommand,
      grantedByRole: "COORDINATOR",
      interestPct: 999,
    });
    expect(repo.saved[0]!.credit.interestPct).toBe(999);
  });
});
