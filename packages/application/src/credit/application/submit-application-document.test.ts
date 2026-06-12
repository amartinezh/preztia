import { describe, it, expect } from "vitest";
import {
  createCreditApplication,
  type DocumentReviewDecision,
  findDocumentSpec,
  type FraudAssessment,
  type MediaRef,
  recordDocumentResult,
  REQUESTED_DOCUMENTS,
  type RequiredDocumentSpec,
} from "@preztiaos/domain";
import { SubmitApplicationDocumentHandler } from "./submit-application-document";
import type {
  ActiveCreditApplication,
  AntifraudInput,
  AntifraudService,
  ApplicantRef,
  ApplicationCompletionNotifier,
  CreditApplicationRepository,
  DocumentOutcome,
  DocumentReviewJob,
  DocumentReviewResult,
  DocumentReviewer,
  DownloadedMedia,
  DocumentStorage,
  InboundMessageDeduplicator,
  MediaDownloader,
  RequiredDocumentCatalog,
  StoredDocument,
  TenantResolver,
} from "./ports";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";

const tenantId = "11111111-1111-1111-1111-111111111111";

class FakeTenants implements TenantResolver {
  constructor(private readonly id: string | null = tenantId) {}
  async resolveByChannel() { return this.id; }
}
class FakeDedup implements InboundMessageDeduplicator {
  constructor(private readonly first: boolean = true) {}
  async firstSeen() { return this.first; }
}
class FakeRepo implements CreditApplicationRepository {
  saved: DocumentOutcome[] = [];
  constructor(private readonly active: ActiveCreditApplication | null) {}
  async findActiveByApplicant(_: ApplicantRef) { return this.active; }
  async create() { return "app-1"; }
  async reset() {}
  async saveDocumentOutcome(o: DocumentOutcome) { this.saved.push(o); }
}
class FakeCatalog implements RequiredDocumentCatalog {
  async listRequested() { return SPECS; }
}
class FakeDownloader implements MediaDownloader {
  async download(): Promise<DownloadedMedia> {
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", sizeBytes: 3, sha256: "abc" };
  }
}
class FakeStorage implements DocumentStorage {
  stored = 0;
  async store(): Promise<StoredDocument> { this.stored += 1; return { storageKey: "k", sha256: "abc" }; }
}
class StubAntifraud implements AntifraudService {
  seen: AntifraudInput[] = [];
  constructor(private readonly result: FraudAssessment) {}
  async assess(input: AntifraudInput) { this.seen.push(input); return this.result; }
}
class FakeReviewer implements DocumentReviewer {
  jobs: DocumentReviewJob[] = [];
  constructor(private readonly result: DocumentReviewResult) {}
  async review(job: DocumentReviewJob) { this.jobs.push(job); return this.result; }
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) { this.sent.push({ to, body }); }
}
class SpyCompletion implements ApplicationCompletionNotifier {
  completed: { tenantId: string; applicationId: string; applicant: string }[] = [];
  async onCompleted(input: { tenantId: string; applicationId: string; applicant: string }) {
    this.completed.push(input);
  }
}

const SPECS: readonly RequiredDocumentSpec[] = REQUESTED_DOCUMENTS.map((key) => ({
  key,
  title: `Envíame tu ${key}`,
  description: `Descripción de ${key}`,
}));
const titleOf = (key: (typeof REQUESTED_DOCUMENTS)[number]) => findDocumentSpec(SPECS, key)!.title;

const [DOC1, DOC2] = REQUESTED_DOCUMENTS;
const media: MediaRef = { mediaId: "MID", mimeType: "image/jpeg" };
const command = { messageId: "wamid.1", channelId: "PNID", applicant: "573001112233", media };
const approved: FraudAssessment = { status: "approved", score: 0, reasons: [] };

const review = (decision: DocumentReviewDecision, identifiedType: string | null = null): DocumentReviewResult => ({
  decision,
  identifiedType,
});

const activeFresh = (): ActiveCreditApplication => ({
  id: "app-1",
  application: createCreditApplication(REQUESTED_DOCUMENTS),
});

function build(opts: {
  active: ActiveCreditApplication | null;
  decision?: DocumentReviewResult;
  tenant?: string | null;
  first?: boolean;
}) {
  const repo = new FakeRepo(opts.active);
  const sender = new SpySender();
  const completion = new SpyCompletion();
  const storage = new FakeStorage();
  const reviewer = new FakeReviewer(opts.decision ?? review({ kind: "accepted" }));
  const handler = new SubmitApplicationDocumentHandler(
    new FakeTenants(opts.tenant ?? tenantId),
    new FakeDedup(opts.first ?? true),
    repo,
    new FakeCatalog(),
    new FakeDownloader(),
    storage,
    new StubAntifraud(approved),
    sender,
    completion,
    reviewer,
  );
  return { handler, repo, sender, completion, storage, reviewer };
}

describe("SubmitApplicationDocumentHandler", () => {
  it("acepta: guarda, registra y pide el siguiente", async () => {
    const setup = build({ active: activeFresh(), decision: review({ kind: "accepted" }) });
    await setup.handler.execute(command);

    expect(setup.storage.stored).toBe(1);
    expect(setup.repo.saved[0]?.storageKey).toBe("k");
    expect(setup.repo.saved[0]?.manualReview).toBe(false);
    expect(setup.reviewer.jobs[0]?.documentType).toBe(DOC1);
    expect(setup.sender.sent[0]?.body).toContain(titleOf(DOC2));
  });

  it("acepta el último documento: avisa revisión y completitud", async () => {
    let app = createCreditApplication(REQUESTED_DOCUMENTS);
    app = recordDocumentResult(app, DOC1, true);
    app = recordDocumentResult(app, REQUESTED_DOCUMENTS[1], true);
    const setup = build({ active: { id: "app-1", application: app }, decision: review({ kind: "accepted" }) });

    await setup.handler.execute(command);

    expect(setup.repo.saved[0]?.application.status).toBe("IN_REVIEW");
    expect(setup.sender.sent[0]?.body).toContain("revisión");
    expect(setup.completion.completed).toEqual([
      { tenantId, applicationId: "app-1", applicant: "573001112233" },
    ]);
  });

  it("no coincide y quedan intentos: NO guarda y pide reenviar avisando intentos", async () => {
    const setup = build({
      active: activeFresh(),
      decision: review({ kind: "mismatch_retry", attemptsLeft: 2 }, "Recibo de luz"),
    });
    await setup.handler.execute(command);

    expect(setup.storage.stored).toBe(0);
    expect(setup.repo.saved[0]?.storageKey).toBeNull();
    expect(setup.sender.sent[0]?.body).toContain("no es el correcto");
    expect(setup.sender.sent[0]?.body).toContain("Recibo de luz");
    expect(setup.sender.sent[0]?.body).toContain("2 intentos");
  });

  it("agotados los intentos: ofrece enviarlo para revisión manual (sin guardar)", async () => {
    const setup = build({ active: activeFresh(), decision: review({ kind: "offer_manual_review" }) });
    await setup.handler.execute(command);

    expect(setup.storage.stored).toBe(0);
    expect(setup.sender.sent[0]?.body).toContain("revisión manual");
    expect(setup.sender.sent[0]?.body).toContain("una vez más");
  });

  it("insiste por encima del máximo: acepta para revisión manual (guarda y marca)", async () => {
    const setup = build({ active: activeFresh(), decision: review({ kind: "accepted_for_manual_review" }) });
    await setup.handler.execute(command);

    expect(setup.storage.stored).toBe(1);
    expect(setup.repo.saved[0]?.manualReview).toBe(true);
    expect(setup.sender.sent[0]?.body).toContain("revisión manual");
    expect(setup.sender.sent[0]?.body).toContain(titleOf(DOC2));
  });

  it("rechazo estructural: NO guarda y pide reenviar con el motivo", async () => {
    const setup = build({
      active: activeFresh(),
      decision: review({ kind: "structural_reject", reasons: ["ilegible"] }),
    });
    await setup.handler.execute(command);

    expect(setup.storage.stored).toBe(0);
    expect(setup.sender.sent[0]?.body).toContain("ilegible");
    expect(setup.sender.sent[0]?.body).toContain(titleOf(DOC1));
  });

  it("ignora el mensaje ya procesado (idempotencia de webhook)", async () => {
    const setup = build({ active: activeFresh(), first: false });
    await setup.handler.execute(command);
    expect(setup.repo.saved).toHaveLength(0);
    expect(setup.sender.sent).toHaveLength(0);
  });

  it("ignora el documento si no hay solicitud activa", async () => {
    const setup = build({ active: null });
    await setup.handler.execute(command);
    expect(setup.repo.saved).toHaveLength(0);
    expect(setup.sender.sent).toHaveLength(0);
  });
});
