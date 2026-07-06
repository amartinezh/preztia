import { describe, it, expect } from "vitest";
import type { TextMessage } from "@preztiaos/domain";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";
import type { InboundMessageDeduplicator } from "../application/ports";
import { OfferOrCreateChargeHandler } from "./offer-or-create-charge";
import type {
  ChargeableCredit,
  ChargeableCreditReader,
  ChargeGateway,
  CreatedCharge,
  OpenChargeSession,
  PaymentChargeSessionStore,
} from "./ports";

function text(body: string): TextMessage {
  return {
    kind: "text",
    id: `wamid-${Math.random()}`,
    from: "5511999999999",
    channelId: "chan-1",
    receivedAt: new Date(),
    body,
  };
}

const CHARGEABLE: ChargeableCredit = {
  tenantId: "t1",
  creditId: "credit-1",
  firstName: "Ana",
  installmentMinor: 25000,
  overdueMinor: 75000,
  currency: "BRL",
  provider: "PICPAY",
};

const OPEN_SESSION: OpenChargeSession = {
  sessionId: "sess-1",
  tenantId: "t1",
  creditId: "credit-1",
  installmentMinor: 25000,
  overdueMinor: 75000,
  currency: "BRL",
};

class FakeSessions implements PaymentChargeSessionStore {
  open: OpenChargeSession | null;
  opened: unknown[] = [];
  attached: unknown[] = [];
  failed: unknown[] = [];
  constructor(open: OpenChargeSession | null = null) {
    this.open = open;
  }
  async findOpenByChannel() {
    return this.open;
  }
  async openSession(input: never) {
    this.opened.push(input);
  }
  async attachCharge(input: never) {
    this.attached.push(input);
  }
  async markFailed(input: never) {
    this.failed.push(input);
  }
}

class FakeCredits implements ChargeableCreditReader {
  constructor(private readonly value: ChargeableCredit | null) {}
  async findChargeableByPhone() {
    return this.value;
  }
}

class FakeGateway implements ChargeGateway {
  calls = 0;
  constructor(
    private readonly result: CreatedCharge | Error = {
      merchantChargeId: "CHG-1",
      copyPaste: "00020126PIX",
      expiresAt: null,
    },
  ) {}
  async createCharge(): Promise<CreatedCharge> {
    this.calls++;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) {
    this.sent.push({ to, body });
  }
}

class FakeDedup implements InboundMessageDeduplicator {
  seen = new Set<string>();
  async firstSeen(input: { tenantId: string; messageId: string }) {
    if (this.seen.has(input.messageId)) return false;
    this.seen.add(input.messageId);
    return true;
  }
}

function handler(deps: {
  sessions?: FakeSessions;
  credits?: FakeCredits;
  gateway?: FakeGateway;
  sender?: SpySender;
  dedup?: FakeDedup;
}) {
  return new OfferOrCreateChargeHandler(
    deps.sessions ?? new FakeSessions(),
    deps.credits ?? new FakeCredits(CHARGEABLE),
    deps.gateway ?? new FakeGateway(),
    deps.sender ?? new SpySender(),
    deps.dedup ?? new FakeDedup(),
  );
}

describe("OfferOrCreateChargeHandler", () => {
  it("intención de pago sin sesión: abre sesión y envía el menú de montos", async () => {
    const sessions = new FakeSessions(null);
    const sender = new SpySender();
    const handled = await handler({ sessions, sender }).handle(text("quiero pagar"));

    expect(handled).toBe(true);
    expect(sessions.opened).toHaveLength(1);
    expect(sender.sent[0]?.body).toContain("Ana");
    expect(sender.sent[0]?.body).toContain("R$ 250,00");
    expect(sender.sent[0]?.body).toContain("R$ 750,00");
  });

  it("mensaje sin intención ni sesión: NO interviene (devuelve false)", async () => {
    const sessions = new FakeSessions(null);
    const handled = await handler({ sessions }).handle(text("cuánto es el interés?"));
    expect(handled).toBe(false);
    expect(sessions.opened).toHaveLength(0);
  });

  it("intención de pago sin crédito activo: avisa y no abre sesión", async () => {
    const sessions = new FakeSessions(null);
    const sender = new SpySender();
    const handled = await handler({
      sessions,
      credits: new FakeCredits(null),
      sender,
    }).handle(text("quiero pagar"));

    expect(handled).toBe(true);
    expect(sessions.opened).toHaveLength(0);
    expect(sender.sent[0]?.body).toContain("crédito activo");
  });

  it("con sesión abierta y selección '2': genera la cobrança por el total y envía el copia-e-cola", async () => {
    const sessions = new FakeSessions(OPEN_SESSION);
    const gateway = new FakeGateway();
    const sender = new SpySender();
    const handled = await handler({ sessions, gateway, sender }).handle(text("2"));

    expect(handled).toBe(true);
    expect(gateway.calls).toBe(1);
    expect(sessions.attached).toEqual([
      expect.objectContaining({
        sessionId: "sess-1",
        amountMinor: 75000,
        merchantChargeId: "CHG-1",
        copyPaste: "00020126PIX",
      }),
    ]);
    expect(sender.sent[0]?.body).toContain("00020126PIX");
    expect(sender.sent[0]?.body).toContain("R$ 750,00");
  });

  it("con sesión abierta y monto libre menor que la cuota: genera cobrança por ese valor", async () => {
    const sessions = new FakeSessions(OPEN_SESSION);
    const gateway = new FakeGateway();
    await handler({ sessions, gateway }).handle(text("100"));
    expect(sessions.attached).toEqual([
      expect.objectContaining({ amountMinor: 10000 }),
    ]);
  });

  it("con sesión abierta y respuesta ilegible: re-pregunta sin generar cobrança", async () => {
    const sessions = new FakeSessions(OPEN_SESSION);
    const gateway = new FakeGateway();
    const sender = new SpySender();
    await handler({ sessions, gateway, sender }).handle(text("no sé"));

    expect(gateway.calls).toBe(0);
    expect(sessions.attached).toHaveLength(0);
    expect(sender.sent[0]?.body).toContain("No entendí");
  });

  it("falla la generación en el proveedor: marca la sesión fallida y avisa (degradación)", async () => {
    const sessions = new FakeSessions(OPEN_SESSION);
    const gateway = new FakeGateway(new Error("PicPay 500"));
    const sender = new SpySender();
    await handler({ sessions, gateway, sender }).handle(text("1"));

    expect(sessions.attached).toHaveLength(0);
    expect(sessions.failed).toHaveLength(1);
    expect(sender.sent[0]?.body).toContain("problema al generar");
  });

  it("es idempotente: un wamid repetido en la selección no genera dos cobranças", async () => {
    const sessions = new FakeSessions(OPEN_SESSION);
    const gateway = new FakeGateway();
    const dedup = new FakeDedup();
    const h = handler({ sessions, gateway, dedup });
    const msg = text("1");
    await h.handle(msg);
    await h.handle(msg);
    expect(gateway.calls).toBe(1);
  });
});
