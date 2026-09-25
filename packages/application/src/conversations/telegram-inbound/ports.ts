import type { InboundMessage } from "@preztiaos/domain";
import type { TelegramContactRejection } from "@preztiaos/domain";

// Entrada de Telegram ya NORMALIZADA (sin HTTP ni la forma del Update de la Bot API) y los puertos
// que necesita la identificación del remitente (ADR #40, D1).

/** Parte del mensaje que depende de su tipo (texto, media, ubicación…), sin la identidad. */
export type InboundContent = InboundMessage extends infer M
  ? M extends InboundMessage
    ? Omit<M, "id" | "from" | "channelId" | "receivedAt">
    : never
  : never;

interface TelegramInboundBase {
  /** chat_id del chat privado (int64 como texto). */
  readonly chatId: string;
  /** message_id: único solo dentro del chat. */
  readonly messageId: number;
  readonly receivedAt: Date;
}

/** El usuario compartió un contacto (idealmente el suyo, con el botón del bot). */
export interface TelegramContactInbound extends TelegramInboundBase {
  readonly type: "contact";
  readonly senderUserId: string;
  readonly contactUserId: string | null;
  readonly phoneNumber: string;
}

/** Comando /start: primer contacto con el bot (o reapertura del chat). */
export interface TelegramStartInbound extends TelegramInboundBase {
  readonly type: "start";
}

/** Mensaje de negocio (texto, imagen, documento, audio, ubicación). */
export interface TelegramContentInbound extends TelegramInboundBase {
  readonly type: "content";
  readonly content: InboundContent;
}

export type TelegramInbound =
  | TelegramContactInbound
  | TelegramStartInbound
  | TelegramContentInbound;

export interface TelegramChatRef {
  readonly tenantId: string;
  /** `tg:<bot_id>` */
  readonly channelId: string;
  readonly chatId: string;
}

/** Puerto: vínculos chat de Telegram ⇄ teléfono verificado (`telegram_chat_link`, bajo RLS). */
export interface TelegramChatLinkStore {
  /**
   * Registra el chat si es nuevo y devuelve su teléfono verificado (null si aún no compartió su
   * contacto). Que el usuario escriba de nuevo levanta la marca de "bot bloqueado".
   */
  openChat(chat: TelegramChatRef): Promise<{ phone: string | null }>;
  /**
   * Vincula el teléfono verificado al chat (registrándolo si es nuevo). Si otro chat del mismo bot
   * tenía ese teléfono, se le retira: el último contacto verificado gana (cambio de
   * dispositivo/cuenta).
   */
  linkPhone(input: TelegramChatRef & { phone: string }): Promise<void>;
}

/** Puerto: mensajes del bot durante la identificación (texto + teclado nativo de Telegram). */
export interface TelegramContactPrompter {
  /** Pide compartir el número con el botón de contacto. */
  requestContact(chat: { channelId: string; chatId: string }): Promise<void>;
  /** Confirma la identificación y retira el teclado. */
  confirmIdentified(chat: { channelId: string; chatId: string }): Promise<void>;
  /** Explica por qué no se aceptó el contacto y vuelve a pedirlo. */
  rejectContact(
    chat: { channelId: string; chatId: string },
    reason: TelegramContactRejection,
  ): Promise<void>;
}
