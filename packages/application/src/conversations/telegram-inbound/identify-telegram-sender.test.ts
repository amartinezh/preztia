import { describe, expect, it } from "vitest";
import type { TelegramContactRejection } from "@preztiaos/domain";
import { IdentifyTelegramSenderHandler } from "./identify-telegram-sender";
import type {
  TelegramChatLinkStore,
  TelegramChatRef,
  TelegramContactPrompter,
  TelegramInbound,
} from "./ports";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CHANNEL = "tg:7012345678";
const CHAT = "555001";
const USER = "555001";
const PHONE = "5561999998888";
const RECEIVED_AT = new Date("2026-09-25T12:00:00Z");

/** Vínculos en memoria: un teléfono por chat y a lo sumo un chat por teléfono (por bot). */
class InMemoryLinks implements TelegramChatLinkStore {
  phones = new Map<string, string | null>();

  async openChat(chat: TelegramChatRef): Promise<{ phone: string | null }> {
    if (!this.phones.has(chat.chatId)) this.phones.set(chat.chatId, null);
    return { phone: this.phones.get(chat.chatId) ?? null };
  }

  async linkPhone(input: TelegramChatRef & { phone: string }): Promise<void> {
    for (const [chatId, phone] of this.phones) {
      if (phone === input.phone) this.phones.set(chatId, null);
    }
    this.phones.set(input.chatId, input.phone);
  }
}

class SpyPrompter implements TelegramContactPrompter {
  events: string[] = [];
  async requestContact(): Promise<void> {
    this.events.push("request");
  }
  async confirmIdentified(): Promise<void> {
    this.events.push("confirm");
  }
  async rejectContact(_: unknown, reason: TelegramContactRejection): Promise<void> {
    this.events.push(`reject:${reason}`);
  }
}

function setup() {
  const links = new InMemoryLinks();
  const prompter = new SpyPrompter();
  const handler = new IdentifyTelegramSenderHandler(links, prompter);
  const run = (inbound: TelegramInbound) =>
    handler.execute({ tenantId: TENANT, channelId: CHANNEL, inbound });
  return { links, prompter, run };
}

const base = { chatId: CHAT, messageId: 7, receivedAt: RECEIVED_AT };
const text = (body: string): TelegramInbound => ({
  ...base,
  type: "content",
  content: { kind: "text", body },
});
const ownContact = (phoneNumber = "+55 61 99999-8888"): TelegramInbound => ({
  ...base,
  type: "contact",
  senderUserId: USER,
  contactUserId: USER,
  phoneNumber,
});

describe("IdentifyTelegramSenderHandler", () => {
  it("pide el número a un chat nuevo y NO deja pasar el mensaje al negocio", async () => {
    const { prompter, run } = setup();

    await expect(run(text("quiero un crédito"))).resolves.toBeNull();
    expect(prompter.events).toEqual(["request"]);
  });

  it("vincula el contacto propio y confirma la identificación", async () => {
    const { links, prompter, run } = setup();

    await expect(run(ownContact())).resolves.toBeNull();
    expect(links.phones.get(CHAT)).toBe(PHONE);
    expect(prompter.events).toEqual(["confirm"]);
  });

  it("rechaza el contacto de un tercero sin vincular nada", async () => {
    const { links, prompter, run } = setup();

    await run({ ...base, type: "contact", senderUserId: USER, contactUserId: "999", phoneNumber: PHONE });

    expect(links.phones.get(CHAT)).toBeUndefined();
    expect(prompter.events).toEqual(["reject:NOT_OWN_CONTACT"]);
  });

  it("rechaza un número inválido", async () => {
    const { prompter, run } = setup();

    await run(ownContact("123"));

    expect(prompter.events).toEqual(["reject:INVALID_PHONE"]);
  });

  it("traduce el mensaje de un chat identificado al InboundMessage común (from = teléfono)", async () => {
    const { run } = setup();
    await run(ownContact());

    await expect(run(text("¿cuánto debo?"))).resolves.toEqual({
      kind: "text",
      body: "¿cuánto debo?",
      id: `${CHANNEL}:${CHAT}:7`,
      from: PHONE,
      channelId: CHANNEL,
      receivedAt: RECEIVED_AT,
    });
  });

  it("conserva el contenido de media (referencia al archivo y caption)", async () => {
    const { run } = setup();
    await run(ownContact());

    const message = await run({
      ...base,
      type: "content",
      content: {
        kind: "image",
        media: { mediaId: "file-1", mimeType: "image/jpeg" },
        caption: "cédula",
      },
    });

    expect(message).toMatchObject({
      kind: "image",
      media: { mediaId: "file-1", mimeType: "image/jpeg" },
      caption: "cédula",
      from: PHONE,
    });
  });

  it("a /start de un chat identificado responde con la confirmación, sin enrutar", async () => {
    const { prompter, run } = setup();
    await run(ownContact());

    await expect(run({ ...base, type: "start" })).resolves.toBeNull();
    expect(prompter.events).toEqual(["confirm", "confirm"]);
  });

  it("a /start de un chat nuevo le pide el número", async () => {
    const { prompter, run } = setup();

    await run({ ...base, type: "start" });

    expect(prompter.events).toEqual(["request"]);
  });

  it("el último contacto verificado gana: el teléfono pasa al chat nuevo", async () => {
    const { links, run } = setup();
    await run(ownContact());

    await run({
      ...base,
      chatId: "777",
      type: "contact",
      senderUserId: "777",
      contactUserId: "777",
      phoneNumber: PHONE,
    });

    expect(links.phones.get("777")).toBe(PHONE);
    expect(links.phones.get(CHAT)).toBeNull();
  });
});
