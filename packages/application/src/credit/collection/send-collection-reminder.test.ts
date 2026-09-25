import { describe, expect, it } from "vitest";
import { ConflictError } from "@preztiaos/domain";
import type { OutboundRecipient, OutboundTextSender } from "../../conversations/text/ports";
import type {
  CollectionAuditLog,
  CollectionReminderTarget,
  DueCreditsReader,
  ReminderIdempotencyStore,
} from "./ports";
import { SendCollectionReminderHandler } from "./send-collection-reminder";

const TENANT = "11111111-1111-1111-1111-111111111111";
const TARGET: CollectionReminderTarget = {
  creditId: "c-1",
  firstName: "Ana",
  phone: "5561999998888",
  channelId: "tg:7012345678",
  dueMinor: 5_000_000,
  currency: "COP",
  pixKey: "pix@preztia.co",
  asOfDate: "2026-09-25",
};

class SpySender implements OutboundTextSender {
  sent: { to: OutboundRecipient; body: string }[] = [];
  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    this.sent.push({ to, body });
  }
}

class MemoryIdempotency implements ReminderIdempotencyStore {
  claims = new Set<string>();
  async claimDailyReminder(input: { creditId: string; date: string }): Promise<boolean> {
    const key = `${input.creditId}:${input.date}`;
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }
}

class SpyAudit implements CollectionAuditLog {
  recorded = 0;
  async recordReminderSent(): Promise<void> {
    this.recorded += 1;
  }
}

function setup(target: CollectionReminderTarget | null = TARGET) {
  const reader: DueCreditsReader = {
    listDue: async () => (target ? [target] : []),
    findDueCredit: async () => target,
  };
  const sender = new SpySender();
  const idempotency = new MemoryIdempotency();
  const audit = new SpyAudit();
  const handler = new SendCollectionReminderHandler(reader, sender, idempotency, audit);
  return { handler, sender, idempotency, audit };
}

describe("SendCollectionReminderHandler", () => {
  it("envía por el canal resuelto del cliente y audita el envío", async () => {
    const { handler, sender, audit } = setup();

    const result = await handler.sendToTarget(TENANT, TARGET);

    expect(result.sent).toBe(true);
    expect(sender.sent[0]?.to).toEqual({ channelId: "tg:7012345678", recipient: "5561999998888" });
    expect(audit.recorded).toBe(1);
  });

  it("omite con motivo explícito si no hay canal alcanzable, SIN consumir la idempotencia del día", async () => {
    const { handler, sender, idempotency } = setup();

    const result = await handler.sendToTarget(TENANT, { ...TARGET, channelId: null });

    expect(result).toMatchObject({ sent: false, reason: "NO_REACHABLE_CHANNEL" });
    expect(sender.sent).toHaveLength(0);
    expect(idempotency.claims.size).toBe(0);
  });

  it("el envío manual informa el mismo motivo (no 'sin crédito activo')", async () => {
    const { handler } = setup({ ...TARGET, channelId: null });

    await expect(
      handler.sendForCredit({ tenantId: TENANT, creditId: "c-1", actorId: "u-1" }),
    ).resolves.toMatchObject({ sent: false, reason: "NO_REACHABLE_CHANNEL" });
  });

  it("envía un solo recordatorio por crédito y día", async () => {
    const { handler, sender } = setup();

    await handler.sendToTarget(TENANT, TARGET);
    const second = await handler.sendToTarget(TENANT, TARGET);

    expect(second).toMatchObject({ sent: false, reason: "ALREADY_SENT_TODAY" });
    expect(sender.sent).toHaveLength(1);
  });

  it("no envía si no hay nada que cobrar", async () => {
    const { handler, sender } = setup();

    await expect(handler.sendToTarget(TENANT, { ...TARGET, dueMinor: 0 })).resolves.toMatchObject({
      sent: false,
      reason: "NOTHING_DUE",
    });
    expect(sender.sent).toHaveLength(0);
  });

  it("sin llave PIX: el manual responde conflicto y el cron omite", async () => {
    const { handler } = setup({ ...TARGET, pixKey: null });

    await expect(
      handler.sendForCredit({ tenantId: TENANT, creditId: "c-1", actorId: "u-1" }),
    ).rejects.toThrow(ConflictError);
    await expect(handler.sendToTarget(TENANT, { ...TARGET, pixKey: null })).resolves.toMatchObject({
      reason: "NO_PIX_KEY",
    });
  });

  it("el manual de un crédito inexistente informa que no hay crédito activo", async () => {
    const { handler } = setup(null);

    await expect(
      handler.sendForCredit({ tenantId: TENANT, creditId: "x", actorId: null }),
    ).resolves.toEqual({ sent: false, reason: "NO_ACTIVE_CREDIT" });
  });
});
