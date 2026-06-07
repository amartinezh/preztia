// Mensaje entrante de WhatsApp ya NORMALIZADO (agnóstico del proveedor).
// Es el resultado de "clasificar": una unión discriminada por `kind` que el
// caso de uso enruta a destinos distintos. El dominio no conoce HTTP ni Meta.

export type MessageKind = "text" | "audio" | "image" | "document";

export interface InboundMessageBase {
  /** id único del mensaje en el proveedor (wamid). Útil para idempotencia. */
  readonly id: string;
  /** teléfono del remitente en formato E.164 (sin '+'). */
  readonly from: string;
  /** phone_number_id del negocio: clave para resolver el tenant más adelante. */
  readonly channelId: string;
  /** instante en que el proveedor recibió el mensaje. */
  readonly receivedAt: Date;
}

/** Referencia a un archivo multimedia alojado en el proveedor (aún sin descargar). */
export interface MediaRef {
  /** id del media en la Graph API; con él se descarga el binario después. */
  readonly mediaId: string;
  readonly mimeType: string;
  readonly sha256?: string;
}

export interface TextMessage extends InboundMessageBase {
  readonly kind: "text";
  readonly body: string;
}

export interface AudioMessage extends InboundMessageBase {
  readonly kind: "audio";
  readonly media: MediaRef;
  /** true si es nota de voz; false si es un archivo de audio adjunto. */
  readonly voice: boolean;
}

export interface ImageMessage extends InboundMessageBase {
  readonly kind: "image";
  readonly media: MediaRef;
  readonly caption?: string;
}

/** Archivo adjunto (p. ej. PDF de un certificado o recibo). */
export interface DocumentMessage extends InboundMessageBase {
  readonly kind: "document";
  readonly media: MediaRef;
  /** nombre original del archivo en el proveedor, si lo informa. */
  readonly filename?: string;
}

export type InboundMessage = TextMessage | AudioMessage | ImageMessage | DocumentMessage;
