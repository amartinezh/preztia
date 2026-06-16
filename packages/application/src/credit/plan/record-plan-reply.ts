import {
  assertOfferTransition,
  isOfferExpired,
  parseAcceptance,
  parsePlanSelection,
  type PlanOfferStatus,
  type TextMessage,
} from "@preztiaos/domain";

import type { InboundMessageDeduplicator } from "../application/ports";
import type { PaymentPlanStore } from "./ports";
import type { PlanOfferNotifier } from "./offer-plans";
import { projectPlanSchedule } from "./project-schedule";

// Estado de la oferta activa de un solicitante, resuelto por canal + teléfono (el webhook no trae
// tenant; la infraestructura lo resuelve por phone_number_id).
export interface ActiveOfferSnapshot {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly planOffer: PlanOfferStatus;
  readonly offeredPrincipalMinor: number;
  readonly offerExpiresAt: Date | null;
}

/** Persistencia de la respuesta del cliente sobre la oferta (transición + auditoría, atómico). */
export interface PlanReplyStore {
  /** Oferta activa (AWAITING_SELECTION/ACCEPTANCE) del solicitante; `null` si no la hay. */
  findActiveOffer(input: {
    channelId: string;
    applicantPhone: string;
  }): Promise<ActiveOfferSnapshot | null>;

  recordSelection(input: {
    tenantId: string;
    applicationId: string;
    offeredPlanId: string;
  }): Promise<void>;

  recordAcceptance(input: {
    tenantId: string;
    applicationId: string;
    acceptedAt: Date;
  }): Promise<void>;

  recordDecline(input: { tenantId: string; applicationId: string }): Promise<void>;
}

/**
 * Caso de uso (webhook): interpreta la respuesta del cliente durante la negociación del plan. Se
 * ejecuta ANTES del asistente de conocimiento: si el solicitante tiene una oferta activa, todos sus
 * mensajes los atiende este handler (modo "negociación") y devuelve `true` para cortar el flujo del
 * asistente; si no hay oferta activa, devuelve `false` y el mensaje sigue su curso normal.
 *
 * Idempotente (no reprocesa el mismo wamid). Respeta el vencimiento de la oferta. No conoce HTTP ni
 * BD: orquesta dominio (parser + máquina de estados + proyección) + puertos.
 */
export class RecordPlanReplyHandler {
  constructor(
    private readonly store: PlanReplyStore,
    private readonly plans: PaymentPlanStore,
    private readonly notifier: PlanOfferNotifier,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly currency: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** @returns `true` si el mensaje se atendió como respuesta a la oferta (no debe ir al asistente). */
  async handle(message: TextMessage): Promise<boolean> {
    const offer = await this.store.findActiveOffer({
      channelId: message.channelId,
      applicantPhone: message.from,
    });
    if (!offer) return false; // no hay negociación en curso → lo atiende el asistente

    // Idempotencia: solo se consume el token una vez confirmado que es contexto de oferta. Un wamid
    // ya procesado no se vuelve a atender (evita doble transición/respuesta ante reentregas).
    if (!(await this.dedup.firstSeen({ tenantId: offer.tenantId, messageId: message.id }))) {
      return true;
    }

    const recipient = { channelId: message.channelId, recipient: message.from };

    if (isOfferExpired(offer.offerExpiresAt, this.clock())) {
      await this.notifier.sendOfferExpired(recipient);
      return true;
    }

    if (offer.planOffer === "AWAITING_SELECTION") {
      await this.handleSelection(offer, message, recipient);
      return true;
    }
    if (offer.planOffer === "AWAITING_ACCEPTANCE") {
      await this.handleAcceptance(offer, message, recipient);
      return true;
    }
    return true;
  }

  private async handleSelection(
    offer: ActiveOfferSnapshot,
    message: TextMessage,
    recipient: { channelId: string; recipient: string },
  ): Promise<void> {
    const active = await this.plans.listActive(offer.tenantId);
    const choice = parsePlanSelection(message.body, active.length);
    if (choice === null) {
      await this.notifier.sendSelectionReask({ ...recipient, plans: active });
      return;
    }
    const plan = active[choice - 1]!;
    assertOfferTransition(offer.planOffer, "SELECT", "AWAITING_ACCEPTANCE");
    await this.store.recordSelection({
      tenantId: offer.tenantId,
      applicationId: offer.applicationId,
      offeredPlanId: plan.id,
    });
    const schedule = projectPlanSchedule({
      principalMinor: offer.offeredPrincipalMinor,
      currency: this.currency,
      plan,
      startDate: this.clock().toISOString().slice(0, 10),
    });
    await this.notifier.sendScheduleForAcceptance({
      ...recipient,
      plan,
      principalMinor: offer.offeredPrincipalMinor,
      currency: this.currency,
      schedule,
    });
  }

  private async handleAcceptance(
    offer: ActiveOfferSnapshot,
    message: TextMessage,
    recipient: { channelId: string; recipient: string },
  ): Promise<void> {
    const decision = parseAcceptance(message.body);
    if (decision === null) {
      await this.notifier.sendAcceptanceReask(recipient);
      return;
    }
    if (decision === "ACCEPT") {
      assertOfferTransition(offer.planOffer, "ACCEPT", "ACCEPTED");
      await this.store.recordAcceptance({
        tenantId: offer.tenantId,
        applicationId: offer.applicationId,
        acceptedAt: this.clock(),
      });
    } else {
      assertOfferTransition(offer.planOffer, "DECLINE", "DECLINED");
      await this.store.recordDecline({
        tenantId: offer.tenantId,
        applicationId: offer.applicationId,
      });
    }
    await this.notifier.sendAcknowledgement({ ...recipient, decision });
  }
}
