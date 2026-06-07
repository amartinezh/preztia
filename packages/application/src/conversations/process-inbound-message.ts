import type { InboundMessage } from "@preztiaos/domain";
import type {
  AudioMessageDispatcher,
  ImageMessageDispatcher,
  TextMessageConsumer,
} from "./ports";

/** Destino al que se enrutó el mensaje; útil para logging/observabilidad. */
export type MessageDestination = "console" | "audio-service" | "document-service";

/**
 * Clasifica un mensaje entrante por su tipo y lo enruta al puerto correspondiente.
 * No conoce WhatsApp, HTTP ni colas: solo coordina dominio + puertos.
 */
export class ProcessInboundMessageHandler {
  constructor(
    private readonly text: TextMessageConsumer,
    private readonly audio: AudioMessageDispatcher,
    private readonly image: ImageMessageDispatcher,
  ) {}

  async execute(message: InboundMessage): Promise<MessageDestination> {
    switch (message.kind) {
      case "text":
        await this.text.consume(message);
        return "console";
      case "audio":
        await this.audio.dispatch(message);
        return "audio-service";
      case "image":
        await this.image.dispatch(message);
        return "document-service";
    }
  }
}
