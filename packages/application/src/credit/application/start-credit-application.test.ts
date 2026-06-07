import { describe, it, expect, beforeEach } from "vitest";
import {
  createCreditApplication,
  documentPrompt,
  nextPendingDocument,
  recordDocumentOutcome,
  REQUESTED_DOCUMENTS,
} from "@preztiaos/domain";
import { StartCreditApplicationHandler } from "./start-credit-application";
import type {
  ActiveCreditApplication,
  ApplicantRef,
  CreditApplicationRepository,
  DocumentOutcome,
} from "./ports";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";

class FakeRepo implements CreditApplicationRepository {
  created: { applicant: ApplicantRef }[] = [];
  constructor(private readonly active: ActiveCreditApplication | null = null) {}
  async findActiveByApplicant() { return this.active; }
  async create(input: { applicant: ApplicantRef }) { this.created.push(input); return "app-1"; }
  async saveDocumentOutcome(_: DocumentOutcome) {}
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) { this.sent.push({ to, body }); }
}

// Destructurar evita el `| undefined` del acceso por índice (noUncheckedIndexedAccess).
const [DOC1] = REQUESTED_DOCUMENTS;

const applicant: ApplicantRef = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  channelId: "PNID",
  applicant: "573001112233",
};

describe("StartCreditApplicationHandler", () => {
  let sender: SpySender;
  beforeEach(() => { sender = new SpySender(); });

  it("crea la solicitud y pide el primer documento cuando no hay una activa", async () => {
    const repo = new FakeRepo(null);
    await new StartCreditApplicationHandler(repo, sender).start(applicant);

    expect(repo.created).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toEqual({ channelId: "PNID", recipient: "573001112233" });
    expect(sender.sent[0]?.body).toContain(documentPrompt(DOC1));
  });

  it("es idempotente: si ya hay solicitud activa no crea otra y recuerda el pendiente", async () => {
    let app = createCreditApplication(REQUESTED_DOCUMENTS);
    app = recordDocumentOutcome(app, DOC1, { status: "approved", score: 0, reasons: [] });
    const repo = new FakeRepo({ id: "app-1", application: app });

    await new StartCreditApplicationHandler(repo, sender).start(applicant);

    expect(repo.created).toHaveLength(0);
    const pending = nextPendingDocument(app);
    expect(pending).not.toBeNull();
    expect(sender.sent[0]?.body).toContain(documentPrompt(pending!));
  });
});
