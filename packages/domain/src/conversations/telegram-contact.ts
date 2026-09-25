import { DomainError } from "../shared/money";

/**
 * Identidad del remitente de Telegram (ADR #40, D1). Telegram no entrega el teléfono de quien
 * escribe: el usuario comparte su contacto con el botón nativo y el sistema lo identifica desde
 * ahí por teléfono, igual que en WhatsApp. La regla crítica es que el contacto sea el PROPIO: un
 * contacto reenviado de otra persona permitiría operar el crédito de un tercero (suplantación).
 */

// Mismo formato que `applicant_phone` / `borrower.phone`: E.164 sin '+', 8–15 dígitos.
const E164_DIGITS = /^\d{8,15}$/;
// Separadores con que Telegram puede formatear el número (`+55 61 99999-8888`, `(61) …`).
const PHONE_SEPARATORS = /[\s+().-]/g;

export type TelegramContactRejection = "NOT_OWN_CONTACT" | "INVALID_PHONE";

export class TelegramContactRejectedError extends DomainError {
  constructor(readonly reason: TelegramContactRejection) {
    super(
      reason === "NOT_OWN_CONTACT"
        ? "El contacto compartido no pertenece a quien escribe"
        : "El teléfono del contacto no es válido",
      `TELEGRAM_CONTACT_${reason}`,
    );
  }
}

export interface SharedTelegramContact {
  /** `from.id` de quien envió el mensaje. */
  readonly senderUserId: string;
  /** `contact.user_id`: solo presente si el contacto es una cuenta de Telegram. */
  readonly contactUserId: string | null;
  readonly phoneNumber: string;
}

/**
 * Teléfono verificado (E.164 sin '+') de un contacto compartido. Falla rápido si el contacto no
 * es del remitente (incluido un contacto sin `user_id`, que no se puede atribuir a nadie) o si
 * el número no tiene forma de teléfono.
 */
export function verifiedPhoneOf(contact: SharedTelegramContact): string {
  if (contact.contactUserId === null || contact.contactUserId !== contact.senderUserId) {
    throw new TelegramContactRejectedError("NOT_OWN_CONTACT");
  }
  const phone = contact.phoneNumber.replace(PHONE_SEPARATORS, "");
  if (!E164_DIGITS.test(phone)) {
    throw new TelegramContactRejectedError("INVALID_PHONE");
  }
  return phone;
}

/**
 * Id de un mensaje de Telegram para la idempotencia (`processed_inbound_message`) y la traza.
 * `message_id` solo es único DENTRO de un chat, así que se califica con el canal y el chat.
 */
export function telegramInboundMessageId(
  channelId: string,
  chatId: string,
  messageId: number,
): string {
  return `${channelId}:${chatId}:${messageId}`;
}
