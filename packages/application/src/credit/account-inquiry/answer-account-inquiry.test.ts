import { describe, it, expect } from "vitest";
import type { TextMessage } from "@preztiaos/domain";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";
import type { InboundMessageDeduplicator } from "../application/ports";
import { AnswerAccountInquiryHandler } from "./answer-account-inquiry";
import type { BorrowerAccount, BorrowerAccountReader } from "./ports";

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

const ACCOUNT: BorrowerAccount = {
  tenantId: "t1",
  firstName: "Ana",
  currency: "COP",
  credits: [
    {
      startDate: "2026-07-01",
      totalDueMinor: 12600000,
      totalPaidMinor: 5200000,
      outstandingMinor: 7400000,
      dueTodayMinor: 4200000,
      overdueMinor: 3200000,
      movements: [
        { date: "2026-07-10", amountMinor: 1000000 },
        { date: "2026-07-05", amountMinor: 4200000 },
      ],
    },
  ],
};

class FakeAccounts implements BorrowerAccountReader {
  calls: { channelId: string; phone: string }[] = [];
  constructor(private readonly value: BorrowerAccount | null) {}
  async findAccountByPhone(input: { channelId: string; phone: string }) {
    this.calls.push(input);
    return this.value;
  }
}
class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string) {
    this.sent.push({ to, body });
  }
}
class FakeDedup implements InboundMessageDeduplicator {
  seen: { tenantId: string; messageId: string }[] = [];
  constructor(private readonly first: boolean = true) {}
  async firstSeen(input: { tenantId: string; messageId: string }) {
    this.seen.push(input);
    return this.first;
  }
}

describe("AnswerAccountInquiryHandler", () => {
  it("no interviene si el mensaje no pide saldo ni movimiento", async () => {
    const accounts = new FakeAccounts(ACCOUNT);
    const sender = new SpySender();
    const handler = new AnswerAccountInquiryHandler(accounts, sender, new FakeDedup());

    const handled = await handler.handle(text("quiero pagar"));

    expect(handled).toBe(false);
    expect(accounts.calls).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it("saldo: responde total, abonado, lo que falta y la mora", async () => {
    const sender = new SpySender();
    const handler = new AnswerAccountInquiryHandler(new FakeAccounts(ACCOUNT), sender, new FakeDedup());

    const handled = await handler.handle(text("¿cuál es mi saldo?"));

    expect(handled).toBe(true);
    const body = sender.sent[0]?.body ?? "";
    expect(body).toContain("Valor total del crédito: $ 126.000,00");
    expect(body).toContain("Has abonado: $ 52.000,00");
    expect(body).toContain("Te falta por pagar: $ 74.000,00");
    expect(body).toContain("Debes a la fecha: $ 42.000,00");
    expect(body).toContain("En mora (atrasado): $ 32.000,00");
  });

  it("movimiento: lista los pagos con el saldo y la mora", async () => {
    const sender = new SpySender();
    const handler = new AnswerAccountInquiryHandler(new FakeAccounts(ACCOUNT), sender, new FakeDedup());

    const handled = await handler.handle(text("quiero ver el movimiento"));

    expect(handled).toBe(true);
    const body = sender.sent[0]?.body ?? "";
    expect(body).toContain("2026-07-10 — $ 10.000,00");
    expect(body).toContain("2026-07-05 — $ 42.000,00");
    expect(body).toContain("Te falta por pagar: $ 74.000,00");
    expect(body).toContain("En mora (atrasado): $ 32.000,00");
  });

  it("sin crédito activo: avisa y corta el flujo", async () => {
    const sender = new SpySender();
    const dedup = new FakeDedup();
    const handler = new AnswerAccountInquiryHandler(new FakeAccounts(null), sender, dedup);

    const handled = await handler.handle(text("cuánto debo"));

    expect(handled).toBe(true);
    expect(dedup.seen).toHaveLength(0); // no gasta token de idempotencia en un falso positivo
    expect(sender.sent[0]?.body).toContain("No encontramos un crédito activo");
  });

  it("idempotencia: un wamid ya visto no reenvía la respuesta", async () => {
    const sender = new SpySender();
    const handler = new AnswerAccountInquiryHandler(
      new FakeAccounts(ACCOUNT),
      sender,
      new FakeDedup(false),
    );

    const handled = await handler.handle(text("saldo"));

    expect(handled).toBe(true);
    expect(sender.sent).toHaveLength(0);
  });
});
