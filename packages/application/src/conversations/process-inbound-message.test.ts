import { describe, it, expect, beforeEach } from "vitest";
import type { AudioMessage, ImageMessage, InboundMessage, TextMessage } from "@preztiaos/domain";
import { ProcessInboundMessageHandler } from "./process-inbound-message";
import type { AudioMessageDispatcher, ImageMessageDispatcher, TextMessageConsumer } from "./ports";

class SpyTextConsumer implements TextMessageConsumer {
  received: TextMessage[] = [];
  async consume(m: TextMessage) { this.received.push(m); }
}
class SpyAudioDispatcher implements AudioMessageDispatcher {
  received: AudioMessage[] = [];
  async dispatch(m: AudioMessage) { this.received.push(m); }
}
class SpyImageDispatcher implements ImageMessageDispatcher {
  received: ImageMessage[] = [];
  async dispatch(m: ImageMessage) { this.received.push(m); }
}

const base = { id: "wamid.1", from: "573001112233", channelId: "PNID", receivedAt: new Date(0) };

describe("ProcessInboundMessageHandler", () => {
  let text: SpyTextConsumer;
  let audio: SpyAudioDispatcher;
  let image: SpyImageDispatcher;
  let handler: ProcessInboundMessageHandler;

  beforeEach(() => {
    text = new SpyTextConsumer();
    audio = new SpyAudioDispatcher();
    image = new SpyImageDispatcher();
    handler = new ProcessInboundMessageHandler(text, audio, image);
  });

  it("el texto va al consumidor de consola y a ningún otro destino", async () => {
    const msg: InboundMessage = { ...base, kind: "text", body: "hola" };
    expect(await handler.execute(msg)).toBe("console");
    expect(text.received).toEqual([msg]);
    expect(audio.received).toHaveLength(0);
    expect(image.received).toHaveLength(0);
  });

  it("el audio va al servicio de transcripción", async () => {
    const msg: InboundMessage = { ...base, kind: "audio", voice: true, media: { mediaId: "m1", mimeType: "audio/ogg" } };
    expect(await handler.execute(msg)).toBe("audio-service");
    expect(audio.received).toEqual([msg]);
    expect(text.received).toHaveLength(0);
    expect(image.received).toHaveLength(0);
  });

  it("la imagen va al servicio de documentos", async () => {
    const msg: InboundMessage = { ...base, kind: "image", media: { mediaId: "m2", mimeType: "image/jpeg" } };
    expect(await handler.execute(msg)).toBe("document-service");
    expect(image.received).toEqual([msg]);
    expect(text.received).toHaveLength(0);
    expect(audio.received).toHaveLength(0);
  });
});
