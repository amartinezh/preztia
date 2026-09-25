import { describe, expect, it } from "vitest";
import { ConflictError, DomainError } from "../shared/money";
import {
  assertSameTelegramBot,
  channelProviderOf,
  telegramBotIdOf,
  telegramChannelId,
  type MessagingProvider,
} from "./messaging-channel";

describe("channelProviderOf", () => {
  it("trata el phone_number_id de Meta (sin prefijo) como WhatsApp", () => {
    expect(channelProviderOf("1234567890")).toBe<MessagingProvider>("WHATSAPP");
  });

  it("reconoce el canal de Telegram por su prefijo", () => {
    expect(channelProviderOf("tg:7012345678")).toBe<MessagingProvider>("TELEGRAM");
  });

  it("no confunde un número de WhatsApp con un bot aunque ambos sean numéricos", () => {
    expect(channelProviderOf("7012345678")).toBe<MessagingProvider>("WHATSAPP");
  });

  it.each(["", "   "])("falla rápido ante un canal vacío (%j)", (channelId) => {
    expect(() => channelProviderOf(channelId)).toThrow(DomainError);
  });

  it.each(["tg:", "tg:abc", "tg:0", "tg:-5", "tg:12:34", "tg: 12"])(
    "falla rápido ante un canal de Telegram mal formado (%j)",
    (channelId) => {
      expect(() => channelProviderOf(channelId)).toThrow(DomainError);
    },
  );
});

describe("telegramChannelId / telegramBotIdOf", () => {
  it("construye y desarma el channelId de un bot (ida y vuelta)", () => {
    const channelId = telegramChannelId("7012345678");
    expect(channelId).toBe("tg:7012345678");
    expect(telegramBotIdOf(channelId)).toBe("7012345678");
  });

  it("rechaza un bot_id que no es entero positivo", () => {
    expect(() => telegramChannelId("7012345678:AAH-token")).toThrow(DomainError);
  });

  it("no extrae bot_id de un canal de WhatsApp", () => {
    expect(() => telegramBotIdOf("1234567890")).toThrow(DomainError);
  });
});

describe("assertSameTelegramBot", () => {
  it("acepta la rotación del token del mismo bot", () => {
    expect(() => assertSameTelegramBot("7012345678", "7012345678")).not.toThrow();
  });

  it("rechaza con conflicto el token de otro bot", () => {
    expect(() => assertSameTelegramBot("7012345678", "7099999999")).toThrow(ConflictError);
  });
});
