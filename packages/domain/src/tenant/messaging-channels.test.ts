import { describe, expect, it } from "vitest";
import { DomainError } from "../shared/money";
import {
  DEFAULT_MESSAGING_CHANNELS,
  isProviderEnabled,
  mergeMessagingChannels,
  type MessagingChannelsSettings,
} from "./messaging-channels";

const BOTH: MessagingChannelsSettings = {
  whatsappEnabled: true,
  telegramEnabled: true,
  preferredProactiveChannel: "TELEGRAM",
};

describe("DEFAULT_MESSAGING_CHANNELS", () => {
  it("conserva el comportamiento previo: solo WhatsApp", () => {
    expect(isProviderEnabled(DEFAULT_MESSAGING_CHANNELS, "WHATSAPP")).toBe(true);
    expect(isProviderEnabled(DEFAULT_MESSAGING_CHANNELS, "TELEGRAM")).toBe(false);
  });
});

describe("mergeMessagingChannels", () => {
  it("habilita Telegram junto a WhatsApp", () => {
    expect(
      mergeMessagingChannels(DEFAULT_MESSAGING_CHANNELS, { telegramEnabled: true }),
    ).toEqual({ ...DEFAULT_MESSAGING_CHANNELS, telegramEnabled: true });
  });

  it("permite operar solo con Telegram si el preferido cambia en el mismo parche", () => {
    expect(
      mergeMessagingChannels(DEFAULT_MESSAGING_CHANNELS, {
        whatsappEnabled: false,
        telegramEnabled: true,
        preferredProactiveChannel: "TELEGRAM",
      }),
    ).toEqual({
      whatsappEnabled: false,
      telegramEnabled: true,
      preferredProactiveChannel: "TELEGRAM",
    });
  });

  it("no toca el estado actual con un parche vacío", () => {
    expect(mergeMessagingChannels(BOTH, {})).toEqual(BOTH);
  });

  it("rechaza dejar al tenant sin canales", () => {
    expect(() =>
      mergeMessagingChannels(DEFAULT_MESSAGING_CHANNELS, { whatsappEnabled: false }),
    ).toThrow(DomainError);
  });

  it("rechaza deshabilitar el canal preferido sin cambiar la preferencia", () => {
    expect(() => mergeMessagingChannels(BOTH, { telegramEnabled: false })).toThrow(
      /preferido/,
    );
  });

  it("rechaza preferir un canal deshabilitado", () => {
    expect(() =>
      mergeMessagingChannels(DEFAULT_MESSAGING_CHANNELS, {
        preferredProactiveChannel: "TELEGRAM",
      }),
    ).toThrow(DomainError);
  });

  it("no muta el estado actual (inmutabilidad)", () => {
    const current = { ...BOTH };
    mergeMessagingChannels(current, { preferredProactiveChannel: "WHATSAPP" });
    expect(current).toEqual(BOTH);
  });
});
