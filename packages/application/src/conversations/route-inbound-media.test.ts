import { describe, it, expect } from "vitest";
import type { ImageMessage, MediaClassification } from "@preztiaos/domain";
import { createCreditApplication } from "@preztiaos/domain";
import type {
  ActiveCreditApplication,
  CreditApplicationRepository,
  DownloadedMedia,
  InboundMessageDeduplicator,
  MediaDownloader,
  TenantResolver,
} from "../credit/application/ports";
import type { SubmitDocumentCommand } from "../credit/application/submit-application-document";
import type { ActiveCreditPortfolio, CreditPortfolioRepository, MediaClassifier, PaymentOutcome } from "../credit/payment/ports";
import type { SubmitPaymentReceiptCommand } from "../credit/payment/submit-payment-receipt";
import { RouteInboundMediaHandler } from "./route-inbound-media";

const MEDIA: DownloadedMedia = {
  bytes: new Uint8Array([1]),
  mimeType: "image/jpeg",
  sizeBytes: 1024,
  sha256: "abc",
};

const MESSAGE: ImageMessage = {
  kind: "image",
  id: "wamid-1",
  from: "5511999999999",
  channelId: "ch1",
  receivedAt: new Date(),
  media: { mediaId: "media-1", mimeType: "image/jpeg" },
};

const ACTIVE_APPLICATION: ActiveCreditApplication = {
  id: "app-1",
  application: createCreditApplication(["IDENTITY_DOCUMENT"]),
};

const PORTFOLIO: ActiveCreditPortfolio = { creditId: "credit-1", currency: "BRL", installments: [] };

class FakeTenants implements TenantResolver {
  constructor(private readonly tenantId: string | null = "t1") {}
  async resolveByChannel() {
    return this.tenantId;
  }
}

class FakeDedup implements InboundMessageDeduplicator {
  calls = 0;
  constructor(private readonly first = true) {}
  async firstSeen() {
    this.calls++;
    return this.first;
  }
}

class FakeApplications implements CreditApplicationRepository {
  constructor(private readonly active: ActiveCreditApplication | null) {}
  async findActiveByApplicant() {
    return this.active;
  }
  async create(): Promise<string> {
    throw new Error("no usado");
  }
  async reset(): Promise<void> {
    throw new Error("no usado");
  }
  async saveDocumentOutcome(): Promise<void> {
    throw new Error("no usado");
  }
}

class FakePortfolios implements CreditPortfolioRepository {
  constructor(private readonly portfolio: ActiveCreditPortfolio | null) {}
  async findActiveByPhone() {
    return this.portfolio;
  }
  async savePaymentOutcome(_outcome: PaymentOutcome): Promise<void> {}
}

class FakeDownloader implements MediaDownloader {
  downloads = 0;
  async download() {
    this.downloads++;
    return MEDIA;
  }
}

class FakeClassifier implements MediaClassifier {
  calls = 0;
  constructor(private readonly result: MediaClassification) {}
  async classify() {
    this.calls++;
    return this.result;
  }
}

class SpyDocuments {
  commands: SubmitDocumentCommand[] = [];
  async execute(cmd: SubmitDocumentCommand) {
    this.commands.push(cmd);
  }
}

class SpyPayments {
  commands: SubmitPaymentReceiptCommand[] = [];
  async execute(cmd: SubmitPaymentReceiptCommand) {
    this.commands.push(cmd);
  }
}

const RECEIPT: MediaClassification = {
  kind: "payment_receipt",
  confidence: 0.9,
  pix: {
    amountMinor: 1000,
    currency: "BRL",
    paidAt: null,
    payerName: null,
    payerTaxId: null,
    payerBankName: null,
    receiverName: null,
    receiverPixKey: null,
    endToEndId: null,
    txid: null,
    raw: {},
  },
};

function build(opts: {
  application?: ActiveCreditApplication | null;
  portfolio?: ActiveCreditPortfolio | null;
  classification?: MediaClassification;
  dedup?: FakeDedup;
}) {
  const documents = new SpyDocuments();
  const payments = new SpyPayments();
  const downloader = new FakeDownloader();
  const classifier = new FakeClassifier(opts.classification ?? RECEIPT);
  const router = new RouteInboundMediaHandler(
    new FakeTenants(),
    opts.dedup ?? new FakeDedup(),
    new FakeApplications(opts.application ?? null),
    new FakePortfolios(opts.portfolio ?? null),
    downloader,
    classifier,
    documents,
    payments,
  );
  return { router, documents, payments, downloader, classifier };
}

describe("RouteInboundMediaHandler", () => {
  it("solo solicitud KYC: va directo a documentos sin gastar IA, con media preparado", async () => {
    const { router, documents, payments, classifier, downloader } = build({
      application: ACTIVE_APPLICATION,
    });
    await router.execute(MESSAGE);

    expect(documents.commands).toHaveLength(1);
    expect(documents.commands[0]?.prepared?.tenantId).toBe("t1");
    expect(documents.commands[0]?.prepared?.downloaded).toBe(MEDIA);
    expect(payments.commands).toHaveLength(0);
    expect(classifier.calls).toBe(0);
    expect(downloader.downloads).toBe(1);
  });

  it("solo crédito activo: clasifica y enruta a pagos con la clasificación", async () => {
    const { router, documents, payments, classifier } = build({ portfolio: PORTFOLIO });
    await router.execute(MESSAGE);

    expect(payments.commands).toHaveLength(1);
    expect(payments.commands[0]?.classification).toBe(RECEIPT);
    expect(documents.commands).toHaveLength(0);
    expect(classifier.calls).toBe(1);
  });

  it("coexisten ambos: comprobante con confianza va a pagos", async () => {
    const { router, documents, payments } = build({
      application: ACTIVE_APPLICATION,
      portfolio: PORTFOLIO,
    });
    await router.execute(MESSAGE);

    expect(payments.commands).toHaveLength(1);
    expect(documents.commands).toHaveLength(0);
  });

  it("coexisten ambos con clasificación ambigua: prefiere el KYC", async () => {
    const { router, documents, payments } = build({
      application: ACTIVE_APPLICATION,
      portfolio: PORTFOLIO,
      classification: { kind: "unknown", confidence: 0.2 },
    });
    await router.execute(MESSAGE);

    expect(documents.commands).toHaveLength(1);
    expect(payments.commands).toHaveLength(0);
  });

  it("mensaje repetido: la deduplicación corta antes de descargar (idempotencia)", async () => {
    const { router, documents, payments, downloader } = build({
      application: ACTIVE_APPLICATION,
      portfolio: PORTFOLIO,
      dedup: new FakeDedup(false),
    });
    await router.execute(MESSAGE);

    expect(downloader.downloads).toBe(0);
    expect(documents.commands).toHaveLength(0);
    expect(payments.commands).toHaveLength(0);
  });

  it("sin contexto activo: ignora el media sin descargarlo", async () => {
    const { router, downloader } = build({});
    await router.execute(MESSAGE);
    expect(downloader.downloads).toBe(0);
  });
});
