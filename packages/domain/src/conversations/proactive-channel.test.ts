import { describe, expect, it } from "vitest";
import {
  chooseProactiveChannel,
  type ChannelCandidate,
  type ProactiveChannelInput,
} from "./proactive-channel";
import {
  DEFAULT_MESSAGING_CHANNELS,
  type MessagingChannelsSettings,
} from "../tenant/messaging-channels";

const WA_ZONE = "1111111111";
const WA_OTHER = "2222222222";
const TG_ZONE = "tg:7012345678";
const TG_OTHER = "tg:7099999999";

const BOTH_PREFER_TELEGRAM: MessagingChannelsSettings = {
  whatsappEnabled: true,
  telegramEnabled: true,
  preferredProactiveChannel: "TELEGRAM",
};
const BOTH_PREFER_WHATSAPP: MessagingChannelsSettings = {
  ...BOTH_PREFER_TELEGRAM,
  preferredProactiveChannel: "WHATSAPP",
};
const ONLY_TELEGRAM: MessagingChannelsSettings = {
  whatsappEnabled: false,
  telegramEnabled: true,
  preferredProactiveChannel: "TELEGRAM",
};

const ok = (channelId: string): ChannelCandidate => ({ channelId, reachable: true });
const unreachable = (channelId: string): ChannelCandidate => ({ channelId, reachable: false });

function input(overrides: Partial<ProactiveChannelInput>): ProactiveChannelInput {
  return {
    settings: BOTH_PREFER_TELEGRAM,
    lastInbound: null,
    stored: null,
    zone: [],
    legacyWhatsapp: null,
    ...overrides,
  };
}

describe("chooseProactiveChannel", () => {
  it("usa el canal por el que el cliente escribió por última vez", () => {
    expect(
      chooseProactiveChannel(
        input({ lastInbound: ok(WA_OTHER), stored: ok(TG_OTHER), zone: [ok(TG_ZONE)] }),
      ),
    ).toBe(WA_OTHER);
  });

  it("sin historial, usa el canal guardado en el agregado", () => {
    expect(chooseProactiveChannel(input({ stored: ok(WA_OTHER), zone: [ok(TG_ZONE)] }))).toBe(
      WA_OTHER,
    );
  });

  it("en la zona, prefiere el proveedor elegido por el tenant", () => {
    const zone = [ok(WA_ZONE), ok(TG_ZONE)];
    expect(chooseProactiveChannel(input({ zone }))).toBe(TG_ZONE);
    expect(chooseProactiveChannel(input({ zone, settings: BOTH_PREFER_WHATSAPP }))).toBe(WA_ZONE);
  });

  it("salta un Telegram no alcanzable (sin vínculo o bloqueado) aunque sea el preferido", () => {
    expect(
      chooseProactiveChannel(input({ zone: [unreachable(TG_ZONE), ok(WA_ZONE)] })),
    ).toBe(WA_ZONE);
  });

  it("salta el último canal usado si ya no es alcanzable", () => {
    expect(
      chooseProactiveChannel(input({ lastInbound: unreachable(TG_OTHER), zone: [ok(WA_ZONE)] })),
    ).toBe(WA_ZONE);
  });

  it("ignora los canales de un proveedor deshabilitado en el tenant", () => {
    expect(
      chooseProactiveChannel(
        input({ settings: ONLY_TELEGRAM, lastInbound: ok(WA_OTHER), zone: [ok(TG_ZONE)] }),
      ),
    ).toBe(TG_ZONE);
  });

  it("recurre al número heredado del tenant si nada más sirve", () => {
    expect(
      chooseProactiveChannel(
        input({ settings: DEFAULT_MESSAGING_CHANNELS, zone: [], legacyWhatsapp: WA_OTHER }),
      ),
    ).toBe(WA_OTHER);
  });

  it("no usa el número heredado si WhatsApp está deshabilitado", () => {
    expect(
      chooseProactiveChannel(input({ settings: ONLY_TELEGRAM, legacyWhatsapp: WA_OTHER })),
    ).toBeNull();
  });

  it("devuelve null cuando no hay ningún canal alcanzable (el envío se omite)", () => {
    expect(
      chooseProactiveChannel(
        input({ lastInbound: unreachable(TG_OTHER), zone: [unreachable(TG_ZONE)] }),
      ),
    ).toBeNull();
  });

  it("conserva el comportamiento previo de un tenant solo-WhatsApp: el canal de la zona", () => {
    expect(
      chooseProactiveChannel(
        input({ settings: DEFAULT_MESSAGING_CHANNELS, zone: [ok(WA_ZONE)], legacyWhatsapp: WA_OTHER }),
      ),
    ).toBe(WA_ZONE);
  });

  it("no altera el orden de la zona recibida (inmutabilidad)", () => {
    const zone = [ok(WA_ZONE), ok(TG_ZONE)];
    chooseProactiveChannel(input({ zone }));
    expect(zone.map((c) => c.channelId)).toEqual([WA_ZONE, TG_ZONE]);
  });
});
