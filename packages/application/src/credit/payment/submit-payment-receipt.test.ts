import { describe, it, expect } from "vitest";
import type {
  FraudAssessment,
  MediaClassification,
  PixReceiptData,
  PortfolioInstallment,
} from "@preztiaos/domain";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";
import type { DownloadedMedia, StoredDocument } from "../application/ports";
import type {
  ActiveCreditPortfolio,
  ActiveTenantBankAccount,
  BankPaymentVerifier,
  BankVerificationResult,
  CreditPortfolioRepository,
  PaymentAntifraudService,
  PaymentOutcome,
  PaymentReceiptStorage,
  TenantBankAccountRepository,
} from "./ports";
import { SubmitPaymentReceiptHandler, type SubmitPaymentReceiptCommand } from "./submit-payment-receipt";

const APPROVED: FraudAssessment = { status: "approved", score: 0, reasons: [] };

function pix(overrides: Partial<PixReceiptData> = {}): PixReceiptData {
  return {
    amountMinor: 25000,
    currency: "BRL",
    paidAt: "2026-06-10T15:00:00Z",
    payerName: "Fulano da Silva",
    payerTaxId: "123.456.789-00",
    payerBankName: "Nubank",
    receiverName: "Preztia LTDA",
    receiverPixKey: "pix@preztia.com",
    endToEndId: "E123",
    txid: "TX1",
    raw: {},
    ...overrides,
  };
}

function installment(seq: number, amountDueMinor: number): PortfolioInstallment {
  return { id: `inst-${seq}`, seq, dueDate: "2026-06-15", amountDueMinor, paidMinor: 0, status: "PENDING" };
}

const MEDIA: DownloadedMedia = {
  bytes: new Uint8Array([1]),
  mimeType: "image/jpeg",
  sizeBytes: 1024,
  sha256: "abc123",
};

function receiptClassification(p: PixReceiptData = pix()): MediaClassification {
  return { kind: "payment_receipt", confidence: 0.95, pix: p };
}

function command(classification: MediaClassification): SubmitPaymentReceiptCommand {
  return {
    tenantId: "t1",
    channelId: "ch1",
    payerPhone: "5511999999999",
    messageId: "wamid-1",
    mediaId: "media-1",
    media: MEDIA,
    classification,
  };
}

class FakePortfolioRepo implements CreditPortfolioRepository {
  saved: PaymentOutcome[] = [];
  constructor(private readonly portfolio: ActiveCreditPortfolio | null) {}
  async findActiveByPhone() {
    return this.portfolio;
  }
  async savePaymentOutcome(outcome: PaymentOutcome) {
    this.saved.push(outcome);
  }
}

class FakeBankAccounts implements TenantBankAccountRepository {
  constructor(private readonly account: ActiveTenantBankAccount | null) {}
  async findActive() {
    return this.account;
  }
}

class FakeAntifraud implements PaymentAntifraudService {
  constructor(private readonly assessment: FraudAssessment = APPROVED) {}
  async assess() {
    return this.assessment;
  }
}

class FakeBank implements BankPaymentVerifier {
  calls = 0;
  constructor(private readonly result: BankVerificationResult) {}
  async verify() {
    this.calls++;
    return this.result;
  }
}

class FakeStorage implements PaymentReceiptStorage {
  stored: { creditId: string | null }[] = [];
  async store(input: { tenantId: string; creditId: string | null; media: DownloadedMedia }): Promise<StoredDocument> {
    this.stored.push({ creditId: input.creditId });
    return { storageKey: "payments/key", sha256: input.media.sha256 };
  }
}

class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) {
    this.sent.push({ to, body });
  }
}

const PORTFOLIO: ActiveCreditPortfolio = {
  creditId: "credit-1",
  currency: "BRL",
  installments: [installment(1, 10000), installment(2, 10000), installment(3, 10000)],
};

const CONFIRMED: BankVerificationResult = {
  verification: { status: "confirmed", bankAmountMinor: 25000, bankPaidAt: null },
  rawResponse: { ok: true },
};
const UNAVAILABLE: BankVerificationResult = {
  verification: { status: "unavailable", reason: "timeout" },
};

const ACCOUNT_HOLD: ActiveTenantBankAccount = { countryCode: "BR", bankCode: "INTER", unverifiedPolicy: "HOLD" };
const ACCOUNT_ALLOCATE: ActiveTenantBankAccount = { ...ACCOUNT_HOLD, unverifiedPolicy: "ALLOCATE" };

function handler(deps: {
  repo: FakePortfolioRepo;
  accounts?: TenantBankAccountRepository;
  antifraud?: PaymentAntifraudService;
  bank?: FakeBank;
  storage?: FakeStorage;
  sender?: SpySender;
}) {
  return new SubmitPaymentReceiptHandler(
    deps.repo,
    deps.accounts ?? new FakeBankAccounts(ACCOUNT_HOLD),
    deps.antifraud ?? new FakeAntifraud(),
    deps.bank ?? new FakeBank(CONFIRMED),
    deps.storage ?? new FakeStorage(),
    deps.sender ?? new SpySender(),
  );
}

describe("SubmitPaymentReceiptHandler", () => {
  it("banco confirma: pago VERIFIED, abona en cascada y responde con el saldo", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const sender = new SpySender();
    await handler({ repo, sender }).execute(command(receiptClassification()));

    const outcome = repo.saved[0]!;
    expect(outcome.payment.status).toBe("VERIFIED");
    expect(outcome.payment.bankStatus).toBe("CONFIRMED");
    const allocated = outcome.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated).toBe(25000);
    expect(outcome.creditSettled).toBe(false);
    expect(sender.sent[0]?.body).toContain("✅");
    expect(sender.sent[0]?.body).toContain("Saldo pendiente");
  });

  it("monto bancario manda sobre el extraído y la diferencia queda auditada", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    await handler({ repo }).execute(command(receiptClassification(pix({ amountMinor: 24000 }))));

    const outcome = repo.saved[0]!;
    const allocated = outcome.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated).toBe(25000); // monto del banco
    expect(outcome.payment.fraudReasons?.join(" ")).toContain("difiere");
  });

  it("banco caído con política HOLD: UNVERIFIED sin abonos y cliente avisado", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const sender = new SpySender();
    await handler({ repo, bank: new FakeBank(UNAVAILABLE), sender }).execute(
      command(receiptClassification()),
    );

    const outcome = repo.saved[0]!;
    expect(outcome.payment.status).toBe("UNVERIFIED");
    expect(outcome.allocations).toHaveLength(0);
    expect(sender.sent[0]?.body).toContain("en verificación");
  });

  it("banco caído con política ALLOCATE: abona con el monto extraído", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    await handler({
      repo,
      accounts: new FakeBankAccounts(ACCOUNT_ALLOCATE),
      bank: new FakeBank(UNAVAILABLE),
    }).execute(command(receiptClassification()));

    const outcome = repo.saved[0]!;
    expect(outcome.payment.status).toBe("UNVERIFIED");
    const allocated = outcome.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated).toBe(25000);
  });

  it("sin cuenta bancaria configurada: no consulta banco y queda UNVERIFIED", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const bank = new FakeBank(CONFIRMED);
    await handler({ repo, accounts: new FakeBankAccounts(null), bank }).execute(
      command(receiptClassification()),
    );

    expect(bank.calls).toBe(0);
    expect(repo.saved[0]?.payment.status).toBe("UNVERIFIED");
  });

  it("antifraude rechaza: REJECTED_FRAUD sin abonos, comprobante guardado como evidencia", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const storage = new FakeStorage();
    const sender = new SpySender();
    await handler({
      repo,
      antifraud: new FakeAntifraud({ status: "rejected", score: 100, reasons: ["Comprobante reutilizado"] }),
      storage,
      sender,
    }).execute(command(receiptClassification()));

    const outcome = repo.saved[0]!;
    expect(outcome.payment.status).toBe("REJECTED_FRAUD");
    expect(outcome.allocations).toHaveLength(0);
    expect(storage.stored).toHaveLength(1); // evidencia
    expect(sender.sent[0]?.body).not.toContain("reutilizado"); // no educa al defraudador
  });

  it("monto ilegible: REJECTED_INVALID y se pide reenviar", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const sender = new SpySender();
    await handler({ repo, sender }).execute(
      command(receiptClassification(pix({ amountMinor: null }))),
    );

    expect(repo.saved[0]?.payment.status).toBe("REJECTED_INVALID");
    expect(sender.sent[0]?.body).toContain("legible");
  });

  it("sin crédito activo: registra pago huérfano y orienta al cliente", async () => {
    const repo = new FakePortfolioRepo(null);
    const sender = new SpySender();
    const storage = new FakeStorage();
    await handler({ repo, sender, storage }).execute(command(receiptClassification()));

    const outcome = repo.saved[0]!;
    expect(outcome.payment.creditId).toBeNull();
    expect(outcome.payment.status).toBe("RECEIVED");
    expect(outcome.events[0]?.type).toBe("payment_received_orphan");
    expect(sender.sent[0]?.body).toContain("crédito activo");
  });

  it("no es un comprobante: orienta sin registrar pago", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const sender = new SpySender();
    await handler({ repo, sender }).execute(command({ kind: "unknown", confidence: 0.3 }));

    expect(repo.saved).toHaveLength(0);
    expect(sender.sent[0]?.body).toContain("no parece un comprobante");
  });

  it("sobrepago: crédito saldado y saldo a favor informado y auditado", async () => {
    const repo = new FakePortfolioRepo(PORTFOLIO);
    const sender = new SpySender();
    await handler({
      repo,
      bank: new FakeBank({
        verification: { status: "confirmed", bankAmountMinor: 35000, bankPaidAt: null },
      }),
      sender,
    }).execute(command(receiptClassification(pix({ amountMinor: 35000 }))));

    const outcome = repo.saved[0]!;
    expect(outcome.creditSettled).toBe(true);
    expect(outcome.events.some((e) => e.type === "overpayment_registered")).toBe(true);
    expect(outcome.events.some((e) => e.type === "credit_settled")).toBe(true);
    expect(sender.sent[0]?.body).toContain("saldado");
  });
});
