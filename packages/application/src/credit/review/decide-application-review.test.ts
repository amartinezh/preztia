import { describe, it, expect } from "vitest";
import {
  ConflictError,
  NotFoundError,
  type CreditApplicationStatus,
  type OperationalSettings,
  type PaymentPlan,
  type PlanOfferStatus,
} from "@preztiaos/domain";

import { ApproveApplicationReviewHandler } from "./approve-application-review";
import { RejectApplicationReviewHandler } from "./reject-application-review";
import type { ApplicationDecisionSnapshot, ApplicationDecisionStore } from "./ports";
import type { ScheduledInstallment } from "../grant-credit";
import type { GrantedCreditData } from "./ports";
import type { PaymentPlanStore } from "../plan/ports";
import type { TenantSettingsStore } from "../../tenant/settings";

/** Store en memoria que registra lo persistido para verificar la orquestación. */
class FakeStore implements ApplicationDecisionStore {
  approvals: { credit: GrantedCreditData; schedule: readonly ScheduledInstallment[]; reason: string; decidedBy: string; contact?: { phone: string }; override?: boolean }[] = [];
  rejections: { tenantId: string; applicationId: string; reason: string; decidedBy: string }[] = [];
  constructor(private readonly snapshot: ApplicationDecisionSnapshot | null) {}
  async loadDecisionSnapshot() {
    return this.snapshot;
  }
  async approveAndGrant(input: { credit: GrantedCreditData; schedule: readonly ScheduledInstallment[]; reason: string; decidedBy: string; contact?: { phone: string }; override?: boolean }) {
    this.approvals.push(input);
  }
  async reject(input: { tenantId: string; applicationId: string; reason: string; decidedBy: string }) {
    this.rejections.push(input);
  }
}

const snapshot = (status: CreditApplicationStatus): ApplicationDecisionSnapshot => ({
  status,
  applicantPhone: "5511999990000",
});

const approveCmd = {
  tenantId: "t-1",
  applicationId: "app-1",
  decidedBy: "user-1",
  reason: "Documentos verificados manualmente",
  borrowerId: "11111111-1111-1111-1111-111111111111",
  zoneId: "22222222-2222-2222-2222-222222222222",
  principalMinor: 100_000,
  interestPct: 200,
  installmentsCount: 10,
  currency: "BRL",
};

describe("ApproveApplicationReviewHandler", () => {
  it("aprueba desde IN_REVIEW: persiste el crédito con cronograma y audita la decisión", async () => {
    const store = new FakeStore(snapshot("IN_REVIEW"));
    const handler = new ApproveApplicationReviewHandler(store);

    const result = await handler.execute(approveCmd);

    expect(result.status).toBe("APPROVED");
    expect(result.creditId).toMatch(/[0-9a-f-]{36}/);
    expect(store.approvals).toHaveLength(1);
    const [persisted] = store.approvals;
    expect(persisted!.credit.installmentsCount).toBe(10);
    expect(persisted!.schedule).toHaveLength(10);
    // Invariante de integridad: la suma del cronograma = total (capital + interés).
    const total = persisted!.schedule.reduce((s, i) => s + i.amountDueMinor, 0);
    expect(total).toBe(120_000);
    expect(persisted!.reason).toBe(approveCmd.reason);
    // El teléfono del deudor cae por defecto al del solicitante del expediente.
    expect(persisted!.contact?.phone).toBe("5511999990000");
  });

  it("permite aprobar aunque el expediente quedó AWAITING_DOCUMENTS (override manual)", async () => {
    const store = new FakeStore(snapshot("AWAITING_DOCUMENTS"));
    const result = await new ApproveApplicationReviewHandler(store).execute(approveCmd);
    expect(result.status).toBe("APPROVED");
    expect(store.approvals).toHaveLength(1);
  });

  it("404 si el expediente no existe", async () => {
    const store = new FakeStore(null);
    await expect(new ApproveApplicationReviewHandler(store).execute(approveCmd)).rejects.toBeInstanceOf(NotFoundError);
    expect(store.approvals).toHaveLength(0);
  });

  it("409 si el expediente ya fue rechazado", async () => {
    const store = new FakeStore(snapshot("REJECTED"));
    await expect(new ApproveApplicationReviewHandler(store).execute(approveCmd)).rejects.toBeInstanceOf(ConflictError);
    expect(store.approvals).toHaveLength(0);
  });
});

// ── Fase 10: términos del plan negociado + guarda de aceptación / override ──────────────────────
const PLAN_30: PaymentPlan = {
  id: "plan-30",
  tenantId: "t-1",
  name: "Plan 30 días",
  installmentsCount: 30,
  frequency: "DAILY",
  interestPct: 100,
  isActive: true,
  isDefault: true,
};

const plansStore: PaymentPlanStore = {
  findById: async () => PLAN_30,
} as unknown as PaymentPlanStore;

const settingsWith = (allowAdminOverride: boolean): TenantSettingsStore => ({
  get: async () =>
    ({ allowAdminOverride, clientChoosesPlan: false, planOfferTtlHours: 24 } as OperationalSettings),
  save: async () => {},
});

const offerSnapshot = (
  planOffer: PlanOfferStatus,
): ApplicationDecisionSnapshot => ({
  status: "IN_REVIEW",
  applicantPhone: "5511999990000",
  planOffer,
  offeredPlanId: "plan-30",
  offeredPrincipalMinor: 200_000,
});

describe("ApproveApplicationReviewHandler — negociación de planes (Fase 10)", () => {
  it("aceptado: toma los términos del plan y el capital pactado, no los del comando", async () => {
    const store = new FakeStore(offerSnapshot("ACCEPTED"));
    const handler = new ApproveApplicationReviewHandler(store, plansStore, settingsWith(false));

    await handler.execute(approveCmd); // el comando trae 100_000 / 200 / 10 cuotas

    const [persisted] = store.approvals;
    expect(persisted!.credit.installmentsCount).toBe(30); // del plan, no del comando
    expect(persisted!.credit.interestPct).toBe(100); // del plan
    expect(persisted!.credit.principalMinor).toBe(200_000); // capital ofertado
    expect(persisted!.credit.paymentPlanId).toBe("plan-30");
    expect(persisted!.schedule).toHaveLength(30);
    expect(persisted!.override).toBeFalsy();
  });

  it("no aceptado y override prohibido: 409, no crea el crédito", async () => {
    const store = new FakeStore(offerSnapshot("AWAITING_ACCEPTANCE"));
    const handler = new ApproveApplicationReviewHandler(store, plansStore, settingsWith(false));
    await expect(handler.execute(approveCmd)).rejects.toBeInstanceOf(ConflictError);
    expect(store.approvals).toHaveLength(0);
  });

  it("no aceptado pero override permitido: crea el crédito y lo marca como override", async () => {
    const store = new FakeStore(offerSnapshot("AWAITING_ACCEPTANCE"));
    const handler = new ApproveApplicationReviewHandler(store, plansStore, settingsWith(true));
    const result = await handler.execute(approveCmd);
    expect(result.status).toBe("APPROVED");
    expect(store.approvals[0]!.override).toBe(true);
  });
});

describe("RejectApplicationReviewHandler", () => {
  const rejectCmd = { tenantId: "t-1", applicationId: "app-1", decidedBy: "user-1", reason: "Documento alterado" };

  it("rechaza desde IN_REVIEW y audita el motivo", async () => {
    const store = new FakeStore(snapshot("IN_REVIEW"));
    const result = await new RejectApplicationReviewHandler(store).execute(rejectCmd);
    expect(result.status).toBe("REJECTED");
    expect(store.rejections).toEqual([
      { tenantId: "t-1", applicationId: "app-1", reason: "Documento alterado", decidedBy: "user-1" },
    ]);
  });

  it("409 si ya estaba aprobado", async () => {
    const store = new FakeStore(snapshot("APPROVED"));
    await expect(new RejectApplicationReviewHandler(store).execute(rejectCmd)).rejects.toBeInstanceOf(ConflictError);
    expect(store.rejections).toHaveLength(0);
  });
});
