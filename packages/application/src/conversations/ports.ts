import type { AudioMessage, ImageMessage, TextMessage } from "@preztiaos/domain";

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

/** La imagen se despacha al servicio de documentos (procesamiento futuro). */
export interface ImageMessageDispatcher {
  dispatch(message: ImageMessage): Promise<void>;
}
