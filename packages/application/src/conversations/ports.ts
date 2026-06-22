import type {
  AudioMessage,
  DocumentMessage,
  ImageMessage,
  InboundMessage,
  LocationMessage,
  TextMessage,
} from "@preztiaos/domain";

// Puertos de salida del caso de uso. Un destino por puerto (segregación de
// interfaces): la infraestructura provee la implementación concreta de cada uno.

/** El texto se entrega a un consumidor (hoy, la consola). */
export interface TextMessageConsumer {
  consume(message: TextMessage): Promise<void>;
}

/** El audio se prepara y despacha al servicio de transcripción (contenedor futuro). */
export interface AudioMessageDispatcher {
  dispatch(message: AudioMessage): Promise<void>;
}

/** La imagen se despacha al servicio de documentos (posible documento KYC). */
export interface ImageMessageDispatcher {
  dispatch(message: ImageMessage): Promise<void>;
}

/** El archivo adjunto (PDF, etc.) se despacha al servicio de documentos (posible documento KYC). */
export interface DocumentMessageDispatcher {
  dispatch(message: DocumentMessage): Promise<void>;
}

/** La ubicación compartida se captura en la solicitud activa (verificación geográfica). */
export interface LocationMessageDispatcher {
  dispatch(message: LocationMessage): Promise<void>;
}

/**
 * Puerto: bitácora (transcript) de la conversación. Registra cada mensaje ENTRANTE y
 * SALIENTE por cliente para trazabilidad/auditoría. Es **best-effort**: un fallo al
 * registrar no debe afectar la atención del mensaje.
 */
export interface ConversationLog {
  recordInbound(message: InboundMessage): Promise<void>;
  recordOutbound(
    to: { channelId: string; recipient: string },
    body: string,
  ): Promise<void>;
}
