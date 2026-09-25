import { describe, expect, it } from "vitest";
import {
  ConflictError,
  DEFAULT_MESSAGING_CHANNELS,
  NotFoundError,
  type MessagingChannelsSettings,
} from "@preztiaos/domain";
import type {
  MessagingChannelsReader,
  TelegramBotGateway,
  TelegramBotIdentity,
  TelegramChannelCredentials,
  TelegramChannelStore,
  TelegramWebhookInfo,
  TelegramWebhookRegistration,
} from "./ports";
import { RegisterTelegramChannelHandler } from "./register-telegram-channel";
import { RotateTelegramBotTokenHandler } from "./rotate-telegram-bot-token";
import { VerifyTelegramWebhookHandler } from "./verify-telegram-webhook";
import { RemoveTelegramChannelHandler } from "./remove-telegram-channel";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ZONE = "22222222-2222-2222-2222-222222222222";
const TOKEN = "7012345678:AAH-token-original";
const NEW_TOKEN = "7012345678:AAH-token-rotado";
const BOT: TelegramBotIdentity = { botId: "7012345678", username: "preztia_norte_bot" };
const URL_BASE = "https://api.preztia.co/webhooks/telegram/";
const TELEGRAM_ENABLED: MessagingChannelsSettings = {
  ...DEFAULT_MESSAGING_CHANNELS,
  telegramEnabled: true,
};

class FakeGateway implements TelegramBotGateway {
  bots = new Map<string, TelegramBotIdentity>([
    [TOKEN, BOT],
    [NEW_TOKEN, BOT],
  ]);
  registrations: { token: string; registration: TelegramWebhookRegistration }[] = [];
  deleted: string[] = [];
  failSetWebhook = false;
  failDeleteWebhook = false;
  currentUrl = "";

  async getMe(botToken: string): Promise<TelegramBotIdentity> {
    const bot = this.bots.get(botToken);
    if (!bot) throw new Error("token rechazado");
    return bot;
  }
  async setWebhook(token: string, registration: TelegramWebhookRegistration): Promise<void> {
    if (this.failSetWebhook) throw new Error("Telegram no disponible");
    this.registrations.push({ token, registration });
    this.currentUrl = registration.url;
  }
  async deleteWebhook(token: string): Promise<void> {
    if (this.failDeleteWebhook) throw new Error("token revocado");
    this.deleted.push(token);
  }
  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return {
      url: this.currentUrl,
      pendingUpdateCount: 2,
      lastErrorMessage: null,
      lastErrorAt: null,
    };
  }
}

interface StoredChannel extends TelegramChannelCredentials {
  tenantId: string;
  zoneId: string;
  username: string | null;
  registered: boolean;
}

class InMemoryStore implements TelegramChannelStore {
  channels = new Map<string, StoredChannel>();
  private seq = 0;

  async create(input: Parameters<TelegramChannelStore["create"]>[0]): Promise<{ id: string }> {
    for (const c of this.channels.values()) {
      if (c.botId === input.bot.botId || c.zoneId === input.zoneId) {
        throw new ConflictError("duplicado");
      }
    }
    const id = `ch-${++this.seq}`;
    this.channels.set(id, {
      tenantId: input.tenantId,
      zoneId: input.zoneId,
      botId: input.bot.botId,
      username: input.bot.username,
      botToken: input.botToken,
      hookId: input.hookId,
      secretToken: input.secretToken,
      registered: false,
    });
    return { id };
  }
  async findCredentials(input: { tenantId: string; id: string }) {
    const c = this.channels.get(input.id);
    return c && c.tenantId === input.tenantId ? c : null;
  }
  async markWebhookRegistered(input: { tenantId: string; id: string }): Promise<void> {
    this.channels.get(input.id)!.registered = true;
  }
  async replaceToken(input: {
    tenantId: string;
    id: string;
    botToken: string;
    username: string | null;
  }): Promise<void> {
    const c = this.channels.get(input.id)!;
    this.channels.set(input.id, { ...c, botToken: input.botToken, username: input.username });
  }
  async remove(input: { tenantId: string; id: string }): Promise<void> {
    this.channels.delete(input.id);
  }
}

function settingsReader(settings: MessagingChannelsSettings): MessagingChannelsReader {
  return { get: async () => settings };
}

const endpoint = { urlFor: (hookId: string) => `${URL_BASE}${hookId}` };
let secretSeq = 0;
const secrets = {
  newHookId: () => `hook-${++secretSeq}`,
  newSecretToken: () => `secret-${secretSeq}`,
};

function setup(settings: MessagingChannelsSettings = TELEGRAM_ENABLED) {
  const gateway = new FakeGateway();
  const store = new InMemoryStore();
  const register = new RegisterTelegramChannelHandler(
    settingsReader(settings),
    gateway,
    store,
    endpoint,
    secrets,
  );
  return { gateway, store, register };
}

describe("RegisterTelegramChannelHandler", () => {
  it("vincula el bot a la zona y registra el webhook con su URL opaca y secret", async () => {
    const { gateway, store, register } = setup();

    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });

    const channel = store.channels.get(id)!;
    expect(channel).toMatchObject({ botId: BOT.botId, zoneId: ZONE, registered: true });
    expect(gateway.registrations).toEqual([
      {
        token: TOKEN,
        registration: {
          url: `${URL_BASE}${channel.hookId}`,
          secretToken: channel.secretToken,
          dropPendingUpdates: true,
        },
      },
    ]);
  });

  it("rechaza vincular un bot si Telegram no está habilitado en el tenant", async () => {
    const { gateway, store, register } = setup(DEFAULT_MESSAGING_CHANNELS);

    await expect(
      register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN }),
    ).rejects.toThrow(ConflictError);
    expect(store.channels.size).toBe(0);
    expect(gateway.registrations).toHaveLength(0);
  });

  it("no persiste nada si Telegram rechaza el token", async () => {
    const { store, register } = setup();

    await expect(
      register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: "1:token-invalido" }),
    ).rejects.toThrow();
    expect(store.channels.size).toBe(0);
  });

  it("deshace el alta si el registro del webhook falla (sin canal mudo)", async () => {
    const { gateway, store, register } = setup();
    gateway.failSetWebhook = true;

    await expect(
      register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN }),
    ).rejects.toThrow(/no disponible/);
    expect(store.channels.size).toBe(0);
  });

  it("no toca el webhook si el bot ya está vinculado (conflicto de unicidad)", async () => {
    const { gateway, register } = setup();
    await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });

    await expect(
      register.execute({ tenantId: TENANT, zoneId: "otra-zona", botToken: TOKEN }),
    ).rejects.toThrow(ConflictError);
    expect(gateway.registrations).toHaveLength(1);
  });
});

describe("RotateTelegramBotTokenHandler", () => {
  it("re-registra el webhook con la misma URL y secret y reemplaza el token", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    const before = store.channels.get(id)!;
    const rotate = new RotateTelegramBotTokenHandler(gateway, store, endpoint);

    await rotate.execute({ tenantId: TENANT, id, botToken: NEW_TOKEN });

    expect(store.channels.get(id)!.botToken).toBe(NEW_TOKEN);
    expect(gateway.registrations.at(-1)).toEqual({
      token: NEW_TOKEN,
      registration: {
        url: `${URL_BASE}${before.hookId}`,
        secretToken: before.secretToken,
        dropPendingUpdates: false,
      },
    });
  });

  it("rechaza el token de otro bot sin tocar el canal", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    gateway.bots.set("7099999999:otro", { botId: "7099999999", username: "otro_bot" });
    const rotate = new RotateTelegramBotTokenHandler(gateway, store, endpoint);

    await expect(
      rotate.execute({ tenantId: TENANT, id, botToken: "7099999999:otro" }),
    ).rejects.toThrow(ConflictError);
    expect(store.channels.get(id)!.botToken).toBe(TOKEN);
  });

  it("conserva el token anterior si Telegram rechaza el nuevo registro", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    gateway.failSetWebhook = true;
    const rotate = new RotateTelegramBotTokenHandler(gateway, store, endpoint);

    await expect(rotate.execute({ tenantId: TENANT, id, botToken: NEW_TOKEN })).rejects.toThrow();
    expect(store.channels.get(id)!.botToken).toBe(TOKEN);
  });

  it("no rota el canal de otro tenant", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    const rotate = new RotateTelegramBotTokenHandler(gateway, store, endpoint);

    await expect(
      rotate.execute({ tenantId: "otro-tenant", id, botToken: NEW_TOKEN }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("VerifyTelegramWebhookHandler", () => {
  it("informa el estado sin re-registrar cuando el webhook apunta al servidor", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    const verify = new VerifyTelegramWebhookHandler(gateway, store, endpoint);

    const status = await verify.execute({ tenantId: TENANT, id });

    expect(status).toMatchObject({
      webhookRegistered: true,
      reRegistered: false,
      pendingUpdateCount: 2,
    });
    expect(gateway.registrations).toHaveLength(1);
  });

  it("se autocorrige si el webhook apunta a otra URL", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    gateway.currentUrl = "https://otro-servidor.example/hook";
    const verify = new VerifyTelegramWebhookHandler(gateway, store, endpoint);

    const status = await verify.execute({ tenantId: TENANT, id });

    expect(status).toMatchObject({ webhookRegistered: true, reRegistered: true });
    expect(gateway.registrations.at(-1)!.registration.dropPendingUpdates).toBe(false);
  });
});

describe("RemoveTelegramChannelHandler", () => {
  it("retira el webhook en Telegram y elimina el canal", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    const remove = new RemoveTelegramChannelHandler(gateway, store);

    await expect(remove.execute({ tenantId: TENANT, id })).resolves.toEqual({
      webhookDeleted: true,
    });
    expect(gateway.deleted).toEqual([TOKEN]);
    expect(store.channels.size).toBe(0);
  });

  it("elimina el canal aunque Telegram no confirme el retiro, y lo informa", async () => {
    const { gateway, store, register } = setup();
    const { id } = await register.execute({ tenantId: TENANT, zoneId: ZONE, botToken: TOKEN });
    gateway.failDeleteWebhook = true;
    const remove = new RemoveTelegramChannelHandler(gateway, store);

    await expect(remove.execute({ tenantId: TENANT, id })).resolves.toEqual({
      webhookDeleted: false,
    });
    expect(store.channels.size).toBe(0);
  });

  it("falla con NotFound si el canal no existe", async () => {
    const { gateway, store } = setup();
    const remove = new RemoveTelegramChannelHandler(gateway, store);

    await expect(remove.execute({ tenantId: TENANT, id: "no-existe" })).rejects.toThrow(
      NotFoundError,
    );
  });
});
