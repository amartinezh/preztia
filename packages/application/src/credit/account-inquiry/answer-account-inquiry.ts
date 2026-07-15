import {
  buildAccountBalanceMessage,
  buildAccountMovementsMessage,
  detectAccountInquiry,
  NO_ACTIVE_CREDIT_ACCOUNT,
  type TextMessage,
} from "@preztiaos/domain";
import type { InboundMessageDeduplicator } from "../application/ports";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type { BorrowerAccountReader } from "./ports";

/**
 * Caso de uso de la CONSULTA DE CUENTA (webhook de texto). Se ejecuta como interceptor ANTES del
 * asistente de conocimiento: si el cliente pide su SALDO o el MOVIMIENTO de sus pagos, lee su
 * crédito activo y le responde cuánto debe, cuánto ha abonado, lo que le falta y —siempre— el saldo
 * en mora. Devuelve `true` si atendió el mensaje (corta el flujo), `false` si no aplica.
 *
 * Es informativo (no mueve dinero) e idempotente (no reprocesa el mismo wamid). No conoce WhatsApp
 * ni la BD: orquesta el dominio puro (detección + redactores) y el read model de la cuenta.
 */
export class AnswerAccountInquiryHandler {
  constructor(
    private readonly accounts: BorrowerAccountReader,
    private readonly sender: OutboundTextSender,
    private readonly dedup: InboundMessageDeduplicator,
  ) {}

  /** @returns `true` si el mensaje se atendió como una consulta de cuenta. */
  async handle(message: TextMessage): Promise<boolean> {
    // Solo se interviene si el mensaje pide el saldo o el movimiento (detección determinista).
    const kind = detectAccountInquiry(message.body);
    if (!kind) return false;

    const recipient = { channelId: message.channelId, recipient: message.from };
    const account = await this.accounts.findAccountByPhone({
      channelId: message.channelId,
      phone: message.from,
    });
    if (!account) {
      await this.sender.sendText(recipient, NO_ACTIVE_CREDIT_ACCOUNT);
      return true;
    }

    // Consumir el token de idempotencia solo tras confirmar que hay cuenta que responder.
    if (!(await this.dedup.firstSeen({ tenantId: account.tenantId, messageId: message.id }))) {
      return true;
    }

    const statement = {
      firstName: account.firstName,
      currency: account.currency,
      credits: account.credits,
    };
    const body =
      kind === "movements"
        ? buildAccountMovementsMessage(statement)
        : buildAccountBalanceMessage(statement);
    await this.sender.sendText(recipient, body);
    return true;
  }
}
