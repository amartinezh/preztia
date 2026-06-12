import { describe, it, expect, beforeEach } from "vitest";
import {
  ASSISTANT_UNAVAILABLE_REPLY,
  OFF_TOPIC_REPLY,
  type AssistantAnswer,
  type TextMessage,
} from "@preztiaos/domain";
import { AnswerTextMessageHandler } from "./answer-text-message";
import type { InboundMessageDeduplicator } from "../../credit/application/ports";
import type {
  AssistantRequest,
  CreditApplicationRestarter,
  CreditApplicationStarter,
  KnowledgeAssistant,
  OutboundRecipient,
  OutboundTextSender,
  PendingDocumentReminder,
  TenantAssistantConfig,
  TenantAssistantConfigRepository,
} from "./ports";

class FakeConfigRepo implements TenantAssistantConfigRepository {
  constructor(private readonly config: TenantAssistantConfig | null) {}
  async findByChannelId() { return this.config; }
}
class FakeDedup implements InboundMessageDeduplicator {
  seen: { tenantId: string; messageId: string }[] = [];
  constructor(private readonly first: boolean = true) {}
  async firstSeen(input: { tenantId: string; messageId: string }) {
    this.seen.push(input);
    return this.first;
  }
}
class StubAssistant implements KnowledgeAssistant {
  requests: AssistantRequest[] = [];
  constructor(private readonly result: AssistantAnswer) {}
  async answer(req: AssistantRequest) { this.requests.push(req); return this.result; }
}
class FailingAssistant implements KnowledgeAssistant {
  async answer(): Promise<AssistantAnswer> { throw new Error("Gemini respondió 429"); }
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) { this.sent.push({ to, body }); }
}
class SpyCreditStarter implements CreditApplicationStarter {
  started: { tenantId: string; channelId: string; applicant: string }[] = [];
  async start(input: { tenantId: string; channelId: string; applicant: string }) { this.started.push(input); }
}
class SpyCreditRestarter implements CreditApplicationRestarter {
  restarted: { tenantId: string; channelId: string; applicant: string }[] = [];
  async restart(input: { tenantId: string; channelId: string; applicant: string }) { this.restarted.push(input); }
}
class StubReminder implements PendingDocumentReminder {
  constructor(private readonly reminder: string | null = null) {}
  async forApplicant() { return this.reminder; }
}

const config: TenantAssistantConfig = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  knowledgeBase: "La cuota diaria es de $10.000. Requisitos: cédula y referencia.",
  aiProvider: "GEMINI",
  aiApiKey: "key-123",
};
const message: TextMessage = {
  id: "wamid.1",
  from: "573001112233",
  channelId: "PNID",
  receivedAt: new Date(0),
  kind: "text",
  body: "¿cuánto es la cuota?",
};
const answer = (over: Partial<AssistantAnswer> = {}): AssistantAnswer => ({
  reply: "La cuota diaria es de $10.000.",
  classification: "knowledge_question",
  ...over,
});

describe("AnswerTextMessageHandler", () => {
  let sender: SpySender;
  let credit: SpyCreditStarter;
  let restart: SpyCreditRestarter;
  beforeEach(() => {
    sender = new SpySender();
    credit = new SpyCreditStarter();
    restart = new SpyCreditRestarter();
  });

  const handlerWith = (
    assistant: KnowledgeAssistant,
    opts: { reminder?: StubReminder; dedup?: FakeDedup } = {},
  ) =>
    new AnswerTextMessageHandler(
      new FakeConfigRepo(config),
      opts.dedup ?? new FakeDedup(),
      assistant,
      sender,
      credit,
      restart,
      opts.reminder ?? new StubReminder(),
    );

  it("A: responde una pregunta de conocimiento sin iniciar solicitud", async () => {
    await handlerWith(new StubAssistant(answer())).execute(message);

    expect(sender.sent).toEqual([
      { to: { channelId: "PNID", recipient: "573001112233" }, body: "La cuota diaria es de $10.000." },
    ]);
    expect(credit.started).toHaveLength(0);
  });

  it("B: inicia la solicitud de crédito y delega el mensaje al protocolo", async () => {
    await handlerWith(new StubAssistant(answer({ classification: "credit_application" }))).execute(message);

    expect(sender.sent).toHaveLength(0); // el protocolo envía su propio mensaje
    expect(credit.started).toEqual([{ tenantId: config.tenantId, channelId: "PNID", applicant: "573001112233" }]);
    expect(restart.restarted).toHaveLength(0);
  });

  it("D: reinicia la solicitud y delega el mensaje al protocolo", async () => {
    await handlerWith(new StubAssistant(answer({ classification: "restart_application" }))).execute(message);

    expect(sender.sent).toHaveLength(0); // el reinicio envía su propio mensaje
    expect(restart.restarted).toEqual([{ tenantId: config.tenantId, channelId: "PNID", applicant: "573001112233" }]);
    expect(credit.started).toHaveLength(0);
  });

  it("C: ante un tema fuera de alcance responde el aviso cordial fijo", async () => {
    await handlerWith(new StubAssistant(answer({ classification: "off_topic", reply: "no debería usarse" }))).execute(message);

    expect(sender.sent[0]?.body).toBe(OFF_TOPIC_REPLY);
    expect(credit.started).toHaveLength(0);
  });

  it("insiste: con solicitud activa, anexa el recordatorio del documento pendiente", async () => {
    await handlerWith(new StubAssistant(answer()), { reminder: new StubReminder("Aún falta: Envíame tu cédula.") }).execute(message);

    expect(sender.sent[0]?.body).toBe("La cuota diaria es de $10.000.\n\nAún falta: Envíame tu cédula.");
  });

  it("idempotencia: no reprocesa un wamid ya visto (no llama a la IA ni responde)", async () => {
    const assistant = new StubAssistant(answer());
    await handlerWith(assistant, { dedup: new FakeDedup(false) }).execute(message);

    expect(assistant.requests).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
    expect(credit.started).toHaveLength(0);
  });

  it("degradación elegante: si la IA falla, avisa al usuario sin escalar el error", async () => {
    await handlerWith(new FailingAssistant()).execute(message);

    expect(sender.sent[0]?.body).toBe(ASSISTANT_UNAVAILABLE_REPLY);
    expect(credit.started).toHaveLength(0);
  });

  it("no hace nada si el canal no está configurado o falta la credencial de IA", async () => {
    const assistant = new StubAssistant(answer());
    const dedup = new FakeDedup();
    const handler = new AnswerTextMessageHandler(
      new FakeConfigRepo(null), dedup, assistant, sender, credit, restart, new StubReminder(),
    );

    await handler.execute(message);

    expect(dedup.seen).toHaveLength(0); // ni siquiera intenta deduplicar
    expect(assistant.requests).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
    expect(credit.started).toHaveLength(0);
  });
});
