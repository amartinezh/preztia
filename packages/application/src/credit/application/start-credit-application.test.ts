import { describe, it, expect, beforeEach } from "vitest";
import {
  createCreditApplication,
  findDocumentSpec,
  nextPendingDocument,
  recordDocumentOutcome,
  REQUESTED_DOCUMENTS,
  type RequiredDocumentSpec,
  type RequiredDocumentType,
} from "@preztiaos/domain";
import { StartCreditApplicationHandler } from "./start-credit-application";
import type {
  ActiveCreditApplication,
  ApplicantRef,
  CreditApplicationRepository,
  DocumentOutcome,
  RequiredDocumentCatalog,
} from "./ports";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";

class FakeRepo implements CreditApplicationRepository {
  created: { applicant: ApplicantRef }[] = [];
  resets: { tenantId: string; applicationId: string }[] = [];
  constructor(private readonly active: ActiveCreditApplication | null = null) {}
  async findActiveByApplicant() { return this.active; }
  async create(input: { applicant: ApplicantRef }) { this.created.push(input); return "app-1"; }
  async reset(input: { tenantId: string; applicationId: string }) { this.resets.push(input); }
  async saveDocumentOutcome(_: DocumentOutcome) {}
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) { this.sent.push({ to, body }); }
}
class FakeCatalog implements RequiredDocumentCatalog {
  constructor(private readonly specs: readonly RequiredDocumentSpec[] = SPECS) {}
  async listRequested() { return this.specs; }
}

// Catálogo de prueba: un título reconocible por documento, en el orden por defecto.
const SPECS: readonly RequiredDocumentSpec[] = REQUESTED_DOCUMENTS.map((key) => ({
  key,
  title: `Envíame tu ${key}`,
  description: `Descripción de ${key}`,
}));
const titleOf = (key: RequiredDocumentType) => findDocumentSpec(SPECS, key)!.title;

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
    await new StartCreditApplicationHandler(repo, sender, new FakeCatalog()).start(applicant);

    expect(repo.created).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toEqual({ channelId: "PNID", recipient: "573001112233" });
    expect(sender.sent[0]?.body).toContain(titleOf(DOC1));
  });

  it("es idempotente: si ya hay solicitud activa no crea otra y recuerda el pendiente", async () => {
    let app = createCreditApplication(REQUESTED_DOCUMENTS);
    app = recordDocumentOutcome(app, DOC1, { status: "approved", score: 0, reasons: [] });
    const repo = new FakeRepo({ id: "app-1", application: app });

    await new StartCreditApplicationHandler(repo, sender, new FakeCatalog()).start(applicant);

    expect(repo.created).toHaveLength(0);
    const pending = nextPendingDocument(app);
    expect(pending).not.toBeNull();
    expect(sender.sent[0]?.body).toContain(titleOf(pending!));
  });

  it("si la solicitud activa ya está completa, informa y orienta al reinicio (no queda en silencio)", async () => {
    let app = createCreditApplication(REQUESTED_DOCUMENTS);
    for (const key of REQUESTED_DOCUMENTS) {
      app = recordDocumentOutcome(app, key, { status: "approved", score: 0, reasons: [] });
    }
    const repo = new FakeRepo({ id: "app-1", application: app });

    await new StartCreditApplicationHandler(repo, sender, new FakeCatalog()).start(applicant);

    expect(repo.created).toHaveLength(0);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.body).toContain("revisión");
    expect(sender.sent[0]?.body).toContain("nuevamente");
  });

  it("no hace nada si el tenant no tiene documentos configurados en el catálogo", async () => {
    const repo = new FakeRepo(null);
    await new StartCreditApplicationHandler(repo, sender, new FakeCatalog([])).start(applicant);

    expect(repo.created).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it("reinicia: con solicitud activa la resetea y vuelve a pedir el primer documento", async () => {
    let app = createCreditApplication(REQUESTED_DOCUMENTS);
    app = recordDocumentOutcome(app, DOC1, { status: "approved", score: 0, reasons: [] });
    const repo = new FakeRepo({ id: "app-1", application: app });

    await new StartCreditApplicationHandler(repo, sender, new FakeCatalog()).restart(applicant);

    expect(repo.resets).toEqual([{ tenantId: applicant.tenantId, applicationId: "app-1" }]);
    expect(repo.created).toHaveLength(0);
    expect(sender.sent[0]?.body).toContain(titleOf(DOC1)); // vuelve a pedir el primero
  });

  it("reinicia sin solicitud activa: inicia una nueva", async () => {
    const repo = new FakeRepo(null);
    await new StartCreditApplicationHandler(repo, sender, new FakeCatalog()).restart(applicant);

    expect(repo.resets).toHaveLength(0);
    expect(repo.created).toHaveLength(1);
    expect(sender.sent[0]?.body).toContain(titleOf(DOC1));
  });
});
