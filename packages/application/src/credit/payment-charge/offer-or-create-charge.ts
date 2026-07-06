import {
  buildChargeInstructionsMessage,
  buildPaymentOptionsMessage,
  CHARGE_CREATION_FAILED,
  detectPaymentIntent,
  NO_ACTIVE_CREDIT_TO_PAY,
  parsePaymentChoice,
  PAYMENT_CHOICE_REASK,
  type TextMessage,
} from "@preztiaos/domain";
import type { InboundMessageDeduplicator } from "../application/ports";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type {
  ChargeableCreditReader,
  ChargeGateway,
  PaymentChargeSessionStore,
} from "./ports";

const DEFAULT_CHARGE_TTL_MINUTES = 15;

/**
 * Caso de uso del COBRO CONVERSACIONAL (webhook de texto). Se ejecuta como interceptor ANTES del
 * asistente: si el cliente tiene una sesión de cobro abierta, interpreta su mensaje como la
 * elección del monto y genera la cobrança; si no, y el mensaje EXPRESA que quiere pagar, ofrece el
 * menú de montos. Devuelve `true` si atendió el mensaje (corta el flujo), `false` si no aplica.
 *
 * Idempotente (no reprocesa el mismo wamid). No conoce WhatsApp, PicPay ni BD: orquesta el dominio
 * puro (detección de intención + parser de monto + redactores) y sus puertos.
 */
export class OfferOrCreateChargeHandler {
  constructor(
    private readonly sessions: PaymentChargeSessionStore,
    private readonly credits: ChargeableCreditReader,
    private readonly gateway: ChargeGateway,
    private readonly sender: OutboundTextSender,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly chargeTtlMinutes: number = DEFAULT_CHARGE_TTL_MINUTES,
  ) {}

  /** @returns `true` si el mensaje se atendió como parte del diálogo de cobro. */
  async handle(message: TextMessage): Promise<boolean> {
    const recipient = { channelId: message.channelId, recipient: message.from };

    // 1) ¿Hay una sesión de cobro abierta? → el mensaje es la elección del monto.
    const session = await this.sessions.findOpenByChannel({
      channelId: message.channelId,
      phone: message.from,
    });
    if (session) {
      if (!(await this.dedup.firstSeen({ tenantId: session.tenantId, messageId: message.id }))) {
        return true;
      }
      await this.processSelection(session, message, recipient);
      return true;
    }

    // 2) Sin sesión: solo se interviene si el mensaje EXPRESA intención de pago.
    if (!detectPaymentIntent(message.body)) return false;

    const chargeable = await this.credits.findChargeableByPhone({
      channelId: message.channelId,
      phone: message.from,
    });
    if (!chargeable) {
      await this.sender.sendText(recipient, NO_ACTIVE_CREDIT_TO_PAY);
      return true;
    }
    // Consumir el token solo tras confirmar que hay algo que ofrecer (no gastar dedup en falsos).
    if (!(await this.dedup.firstSeen({ tenantId: chargeable.tenantId, messageId: message.id }))) {
      return true;
    }

    await this.sessions.openSession({
      tenantId: chargeable.tenantId,
      creditId: chargeable.creditId,
      phone: message.from,
      channelId: message.channelId,
      provider: chargeable.provider,
      installmentMinor: chargeable.installmentMinor,
      overdueMinor: chargeable.overdueMinor,
      currency: chargeable.currency,
    });
    await this.sender.sendText(
      recipient,
      buildPaymentOptionsMessage({
        firstName: chargeable.firstName,
        installmentMinor: chargeable.installmentMinor,
        overdueMinor: chargeable.overdueMinor,
        currency: chargeable.currency,
      }),
    );
    return true;
  }

  private async processSelection(
    session: { sessionId: string; tenantId: string; creditId: string; installmentMinor: number; overdueMinor: number; currency: string },
    message: TextMessage,
    recipient: { channelId: string; recipient: string },
  ): Promise<void> {
    const choice = parsePaymentChoice(message.body, {
      installmentMinor: session.installmentMinor,
      overdueMinor: session.overdueMinor,
    });
    if (choice.kind === "reask") {
      await this.sender.sendText(recipient, PAYMENT_CHOICE_REASK);
      return;
    }

    let charge;
    try {
      charge = await this.gateway.createCharge({
        tenantId: session.tenantId,
        creditId: session.creditId,
        amountMinor: choice.amountMinor,
        currency: session.currency,
        payerPhone: message.from,
        expiresInMinutes: this.chargeTtlMinutes,
      });
    } catch {
      // Degradación elegante: el proveedor falló → se avisa y se cierra la sesión.
      await this.sessions.markFailed({ sessionId: session.sessionId, tenantId: session.tenantId });
      await this.sender.sendText(recipient, CHARGE_CREATION_FAILED);
      return;
    }

    await this.sessions.attachCharge({
      sessionId: session.sessionId,
      tenantId: session.tenantId,
      amountMinor: choice.amountMinor,
      merchantChargeId: charge.merchantChargeId,
      copyPaste: charge.copyPaste,
      expiresAt: charge.expiresAt,
    });
    await this.sender.sendText(
      recipient,
      buildChargeInstructionsMessage({
        amountMinor: choice.amountMinor,
        currency: session.currency,
        copyPasteCode: charge.copyPaste,
        expiresInMinutes: this.chargeTtlMinutes,
      }),
    );
  }
}
