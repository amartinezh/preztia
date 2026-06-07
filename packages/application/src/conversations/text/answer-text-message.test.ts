import { describe, it, expect, beforeEach } from "vitest";
import type { AssistantAnswer, TextMessage } from "@preztiaos/domain";
import { AnswerTextMessageHandler } from "./answer-text-message";
import type {
  AssistantRequest,
  CreditApplicationStarter,
  KnowledgeAssistant,
  OutboundRecipient,
  OutboundTextSender,
  TenantAssistantConfig,
  TenantAssistantConfigRepository,
} from "./ports";

class FakeConfigRepo implements TenantAssistantConfigRepository {
  constructor(private readonly config: TenantAssistantConfig | null) {}
  async findByChannelId() { return this.config; }
}
class StubAssistant implements KnowledgeAssistant {
  requests: AssistantRequest[] = [];
  constructor(private readonly result: AssistantAnswer) {}
  async answer(req: AssistantRequest) { this.requests.push(req); return this.result; }
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) { this.sent.push({ to, body }); }
}
class SpyCreditStarter implements CreditApplicationStarter {
  started: { tenantId: string; channelId: string; applicant: string }[] = [];
  async start(input: { tenantId: string; channelId: string; applicant: string }) { this.started.push(input); }
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
  inScope: true,
  creditIntent: "none",
  ...over,
});

describe("AnswerTextMessageHandler", () => {
  let sender: SpySender;
  let credit: SpyCreditStarter;
  beforeEach(() => {
    sender = new SpySender();
    credit = new SpyCreditStarter();
  });

  it("responde usando la base de conocimiento y no inicia solicitud si no hay intención", async () => {
    const assistant = new StubAssistant(answer());
    const handler = new AnswerTextMessageHandler(new FakeConfigRepo(config), assistant, sender, credit);

    await handler.execute(message);

    expect(assistant.requests[0]?.knowledgeBase).toBe(config.knowledgeBase);
    expect(sender.sent).toEqual([{ to: { channelId: "PNID", recipient: "573001112233" }, body: "La cuota diaria es de $10.000." }]);
    expect(credit.started).toHaveLength(0);
  });

  it("inicia la solicitud de crédito cuando el usuario está listo para aplicar", async () => {
    const assistant = new StubAssistant(answer({ reply: "¡Genial! Iniciemos.", creditIntent: "ready_to_apply" }));
    const handler = new AnswerTextMessageHandler(new FakeConfigRepo(config), assistant, sender, credit);

    await handler.execute(message);

    expect(sender.sent).toHaveLength(1);
    expect(credit.started).toEqual([{ tenantId: config.tenantId, channelId: "PNID", applicant: "573001112233" }]);
  });

  it("no hace nada si el canal no está configurado o falta la credencial de IA", async () => {
    const assistant = new StubAssistant(answer());
    const handler = new AnswerTextMessageHandler(new FakeConfigRepo(null), assistant, sender, credit);

    await handler.execute(message);

    expect(assistant.requests).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
    expect(credit.started).toHaveLength(0);
  });
});
