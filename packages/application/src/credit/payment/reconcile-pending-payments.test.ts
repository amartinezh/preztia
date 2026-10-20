import { describe, it, expect } from "vitest";
import type { PixReceiptData } from "@preztiaos/domain";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type { ActiveCreditPortfolio, BankVerificationResult } from "./ports";
import {
  ReconcilePendingPaymentsHandler,
  type PendingPayment,
  type ReconciliationRepository,
} from "./reconcile-pending-payments";

const PIX: PixReceiptData = {
  amountMinor: 24000,
  currency: "BRL",
  paidAt: null,
  payerName: null,
  payerTaxId: null,
  payerBankName: null,
  receiverName: null,
  receiverPixKey: "pix@preztia.co",
  endToEndId: "E1",
  txid: null,
  raw: {},
};

const PENDING: PendingPayment = {
  id: "pay-1",
  creditId: "credit-1",
  channelId: null,
  payerPhone: "5537900000001",
  pix: PIX,
  reconciliationAttempts: 1,
};

const PORTFOLIO: ActiveCreditPortfolio = {
  creditId: "credit-1",
  currency: "BRL",
  installments: [{ id: "i1", seq: 1, dueDate: "2026-06-10", amountDueMinor: 30000, paidMinor: 0, status: "PENDING" }],
};

type Verification = Parameters<ReconciliationRepository["applyVerification"]>[0];

class FakeReconciliation implements ReconciliationRepository {
  verified: Verification[] = [];
  async listUnverified() {
    return { items: [PENDING], nextCursor: null };
  }
  async loadPortfolio() {
    return PORTFOLIO;
  }
  async applyVerification(input: Verification) {
    this.verified.push(input);
  }
  async keepPending() {}
  async flagSuspectedFraud() {}
}

function handler(repo: FakeReconciliation, bank: BankVerificationResult) {
  return new ReconcilePendingPaymentsHandler(
    repo,
    { listForVerification: async () => [{ countryCode: "BR", bankCode: "INTER", unverifiedPolicy: "HOLD" }] },
    { verify: async () => bank },
    { sendText: async () => {} } as OutboundTextSender,
    3,
    { byTenant: async () => "es", byChannel: async () => "es" },
  );
}

describe("ReconcilePendingPaymentsHandler", () => {
  it("el banco confirma otro monto: se acredita el del banco y lo leído queda como evidencia", async () => {
    const repo = new FakeReconciliation();
    await handler(repo, { verification: { status: "confirmed", bankAmountMinor: 25000, bankPaidAt: null } }).execute({
      tenantId: "t1",
    });

    const verification = repo.verified[0]!;
    expect(verification.creditedAmountMinor).toBe(25000);
    expect(verification.allocation.allocations.reduce((a, x) => a + x.amountMinor, 0)).toBe(25000);
    expect(verification.events[0]?.payload).toMatchObject({ extractedAmountMinor: 24000, bankAmountMinor: 25000 });
  });

  it("montos iguales: sin evidencia de diferencia", async () => {
    const repo = new FakeReconciliation();
    await handler(repo, { verification: { status: "confirmed", bankAmountMinor: 24000, bankPaidAt: null } }).execute({
      tenantId: "t1",
    });

    expect(repo.verified[0]!.creditedAmountMinor).toBe(24000);
    expect(repo.verified[0]!.events[0]?.payload).not.toHaveProperty("extractedAmountMinor");
  });
});
