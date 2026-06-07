import { describe, it, expect, beforeEach } from "vitest";
import {
  createCreditApplication,
  documentPrompt,
  type FraudAssessment,
  type MediaRef,
  recordDocumentOutcome,
  REQUESTED_DOCUMENTS,
} from "@preztiaos/domain";
import { SubmitApplicationDocumentHandler } from "./submit-application-document";
import type {
  ActiveCreditApplication,
  AntifraudInput,
  AntifraudService,
  ApplicantRef,
  CreditApplicationRepository,
  DocumentOutcome,
  DownloadedMedia,
  DocumentStorage,
  InboundMessageDeduplicator,
  MediaDownloader,
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
  async saveDocumentOutcome(o: DocumentOutcome) { this.saved.push(o); }
}
class FakeDownloader implements MediaDownloader {
  async download(): Promise<DownloadedMedia> {
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", sizeBytes: 3, sha256: "abc" };
  }
}
class FakeStorage implements DocumentStorage {
  async store(): Promise<StoredDocument> { return { storageKey: "k", sha256: "abc" }; }
}
class StubAntifraud implements AntifraudService {
  seen: AntifraudInput[] = [];
  constructor(private readonly result: FraudAssessment) {}
  async assess(input: AntifraudInput) { this.seen.push(input); return this.result; }
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) { this.sent.push({ to, body }); }
}

// Destructurar evita el `| undefined` del acceso por índice (noUncheckedIndexedAccess).
const [DOC1, DOC2] = REQUESTED_DOCUMENTS;

const media: MediaRef = { mediaId: "MID", mimeType: "image/jpeg" };
const command = { messageId: "wamid.1", channelId: "PNID", applicant: "573001112233", media };
const approved: FraudAssessment = { status: "approved", score: 0, reasons: [] };
const rejected: FraudAssessment = { status: "rejected", score: 100, reasons: ["ilegible"] };

const activeFresh = (): ActiveCreditApplication => ({
  id: "app-1",
  application: createCreditApplication(REQUESTED_DOCUMENTS),
});

function build(opts: {
  active: ActiveCreditApplication | null;
  assessment?: FraudAssessment;
  tenant?: string | null;
  first?: boolean;
}) {
  const repo = new FakeRepo(opts.active);
  const sender = new SpySender();
  const handler = new SubmitApplicationDocumentHandler(
    new FakeTenants(opts.tenant ?? tenantId),
    new FakeDedup(opts.first ?? true),
    repo,
    new FakeDownloader(),
    new FakeStorage(),
    new StubAntifraud(opts.assessment ?? approved),
    sender,
  );
  return { handler, repo, sender };
}

describe("SubmitApplicationDocumentHandler", () => {
  let setup: ReturnType<typeof build>;

  it("valida el documento y solicita el siguiente", async () => {
    setup = build({ active: activeFresh(), assessment: approved });
    await setup.handler.execute(command);

    expect(setup.repo.saved).toHaveLength(1);
    expect(setup.sender.sent[0]?.body).toContain(documentPrompt(DOC2));
  });

  it("al validar el último documento informa que la solicitud está en revisión", async () => {
    let app = createCreditApplication(REQUESTED_DOCUMENTS);
    // dejar solo el último pendiente
    app = recordDocumentOutcome(app, DOC1, approved);
    app = recordDocumentOutcome(app, DOC2, approved);
    setup = build({ active: { id: "app-1", application: app }, assessment: approved });

    await setup.handler.execute(command);

    expect(setup.repo.saved[0]?.application.status).toBe("IN_REVIEW");
    expect(setup.sender.sent[0]?.body).toContain("revisión");
  });

  it("si el antifraude rechaza, pide reenviar el mismo documento con el motivo", async () => {
    setup = build({ active: activeFresh(), assessment: rejected });
    await setup.handler.execute(command);

    expect(setup.repo.saved).toHaveLength(1);
    expect(setup.sender.sent[0]?.body).toContain("ilegible");
    expect(setup.sender.sent[0]?.body).toContain(documentPrompt(DOC1));
  });

  it("ignora el mensaje ya procesado (idempotencia de webhook)", async () => {
    setup = build({ active: activeFresh(), first: false });
    await setup.handler.execute(command);
    expect(setup.repo.saved).toHaveLength(0);
    expect(setup.sender.sent).toHaveLength(0);
  });

  it("ignora el documento si no hay solicitud activa", async () => {
    setup = build({ active: null });
    await setup.handler.execute(command);
    expect(setup.repo.saved).toHaveLength(0);
    expect(setup.sender.sent).toHaveLength(0);
  });
});
