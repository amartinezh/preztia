import { buildCollectionReminderMessage, ConflictError } from "@preztiaos/domain";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type {
  CollectionAuditLog,
  CollectionReminderTarget,
  CollectionReminderTrigger,
  DueCreditsReader,
  ReminderIdempotencyStore,
  SendReminderResult,
} from "./ports";

/**
 * Caso de uso: envía UN recordatorio de cobro por WhatsApp. Orquesta el read model de cartera,
 * la idempotencia del día, el redactor de dominio, el envío saliente (que además registra el
 * mensaje en el transcript) y la auditoría. No calcula reglas ni arma SQL: delega en cada puerto.
 *
 * Es el corazón común del envío MANUAL (un crédito, desde la UI de Cartera) y del AUTOMÁTICO
 * (cada objetivo del cron). La idempotencia garantiza un solo recordatorio por crédito y día.
 */
export class SendCollectionReminderHandler {
  constructor(
    private readonly dueCredits: DueCreditsReader,
    private readonly sender: OutboundTextSender,
    private readonly idempotency: ReminderIdempotencyStore,
    private readonly audit: CollectionAuditLog,
  ) {}

  /** Envío MANUAL desde la vista de Cartera: resuelve el crédito y despacha. */
  async sendForCredit(input: {
    tenantId: string;
    creditId: string;
    actorId: string | null;
  }): Promise<SendReminderResult> {
    const target = await this.dueCredits.findDueCredit({
      tenantId: input.tenantId,
      creditId: input.creditId,
    });
    if (!target) return { sent: false, reason: "NO_ACTIVE_CREDIT" };
    return this.dispatch(input.tenantId, target, "MANUAL", input.actorId);
  }

  /** Envío AUTOMÁTICO: el objetivo ya viene resuelto por el read model del cron. */
  async sendToTarget(
    tenantId: string,
    target: CollectionReminderTarget,
  ): Promise<SendReminderResult> {
    return this.dispatch(tenantId, target, "CRON", null);
  }

  private async dispatch(
    tenantId: string,
    target: CollectionReminderTarget,
    trigger: CollectionReminderTrigger,
    actorId: string | null,
  ): Promise<SendReminderResult> {
    const summary = {
      phone: target.phone,
      dueMinor: target.dueMinor,
      currency: target.currency,
    };
    if (target.dueMinor <= 0) return { sent: false, reason: "NOTHING_DUE", ...summary };
    if (!target.pixKey) {
      // El envío manual reporta el bloqueo (409); el cron solo lo omite y sigue con el resto.
      if (trigger === "MANUAL") {
        throw new ConflictError("El tenant no tiene configurada una llave PIX para cobrar");
      }
      return { sent: false, reason: "NO_PIX_KEY", ...summary };
    }

    const claimed = await this.idempotency.claimDailyReminder({
      tenantId,
      creditId: target.creditId,
      date: target.asOfDate,
    });
    if (!claimed) return { sent: false, reason: "ALREADY_SENT_TODAY", ...summary };

    const body = buildCollectionReminderMessage({
      firstName: target.firstName,
      dueMinor: target.dueMinor,
      currency: target.currency,
      pixKey: target.pixKey,
    });
    await this.sender.sendText(
      { channelId: target.channelId, recipient: target.phone },
      body,
    );
    await this.audit.recordReminderSent({
      tenantId,
      creditId: target.creditId,
      actorId,
      trigger,
      dueMinor: target.dueMinor,
      currency: target.currency,
    });
    return { sent: true, messagePreview: body, ...summary };
  }
}
