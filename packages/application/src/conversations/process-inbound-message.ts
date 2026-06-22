import type { InboundMessage } from "@preztiaos/domain";
import type {
  AudioMessageDispatcher,
  ConversationLog,
  DocumentMessageDispatcher,
  ImageMessageDispatcher,
  LocationMessageDispatcher,
  TextMessageConsumer,
} from "./ports";

/** Destino al que se enrutó el mensaje; útil para logging/observabilidad. */
export type MessageDestination =
  | "console"
  | "audio-service"
  | "document-service"
  | "location-service";

/**
 * Clasifica un mensaje entrante por su tipo y lo enruta al puerto correspondiente.
 * No conoce WhatsApp, HTTP ni colas: solo coordina dominio + puertos.
 */
export class ProcessInboundMessageHandler {
  constructor(
    private readonly text: TextMessageConsumer,
    private readonly audio: AudioMessageDispatcher,
    private readonly image: ImageMessageDispatcher,
    private readonly document: DocumentMessageDispatcher,
    private readonly location: LocationMessageDispatcher,
    private readonly conversationLog: ConversationLog,
  ) {}

  async execute(message: InboundMessage): Promise<MessageDestination> {
    // Transcript: registra el mensaje entrante (best-effort) antes de enrutarlo.
    await this.conversationLog.recordInbound(message);

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
      case "document":
        await this.document.dispatch(message);
        return "document-service";
      case "location":
        await this.location.dispatch(message);
        return "location-service";
    }
  }
}
