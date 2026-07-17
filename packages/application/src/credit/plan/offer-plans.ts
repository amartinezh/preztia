import {
  ConflictError,
  NotFoundError,
  assertOfferTransition,
  offerExpiryFrom,
  type PaymentPlan,
  type PlanOfferStatus,
} from "@preztiaos/domain";

import type { PaymentPlanStore } from "./ports";
import type { TenantSettingsStore } from "../../tenant/settings";
import { projectPlanSchedule } from "./project-schedule";
import type { ScheduledInstallment } from "../grant-credit";

// Estado mínimo del expediente para decidir la oferta (KYC + sub-estado de oferta + destinatario).
export interface PlanOfferSnapshot {
  readonly status: string; // CreditApplicationStatus (KYC)
  readonly planOffer: PlanOfferStatus;
  readonly applicantPhone: string;
  /** phone_number_id del canal del negocio: por dónde enviar el WhatsApp. */
  readonly channelId: string;
}

/** Persistencia de la oferta: carga el snapshot y sella la transición + auditoría, atómico. */
export interface PlanOfferStore {
  loadOfferSnapshot(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<PlanOfferSnapshot | null>;

  /** Sella el nuevo sub-estado de oferta + datos + evento append-only, en una transacción. */
  markOffered(input: {
    tenantId: string;
    applicationId: string;
    decidedBy: string;
    to: PlanOfferStatus;
    offeredPlanId: string | null;
    offeredPrincipalMinor: number;
    offerExpiresAt: Date;
  }): Promise<void>;
}

/** Envío de la oferta por WhatsApp (formateo del menú / del cronograma → texto). */
export interface PlanOfferNotifier {
  /** Menú de planes activos para que el cliente elija (toggle ON). */
  sendPlanMenu(input: {
    channelId: string;
    recipient: string;
    plans: readonly PaymentPlan[];
  }): Promise<void>;

  /** Cronograma proyectado + pregunta de aceptación (toggle OFF o tras elegir). */
  sendScheduleForAcceptance(input: {
    channelId: string;
    recipient: string;
    plan: PaymentPlan;
    principalMinor: number;
    currency: string;
    schedule: readonly ScheduledInstallment[];
  }): Promise<void>;

  /** Reenvía el menú cuando la selección no se entendió (re-pregunta). */
  sendSelectionReask(input: {
    channelId: string;
    recipient: string;
    plans: readonly PaymentPlan[];
  }): Promise<void>;

  /** Re-pregunta SÍ/NO cuando la aceptación no se entendió. */
  sendAcceptanceReask(input: { channelId: string; recipient: string }): Promise<void>;

  /** Acuse tras registrar la decisión del cliente (aceptó / rechazó). */
  sendAcknowledgement(input: {
    channelId: string;
    recipient: string;
    decision: "ACCEPT" | "DECLINE";
  }): Promise<void>;

  /** Avisa que la oferta venció (se ignora la respuesta; un asesor retomará). */
  sendOfferExpired(input: { channelId: string; recipient: string }): Promise<void>;
}

export interface OfferPlansCommand {
  readonly tenantId: string;
  readonly applicationId: string;
  /** Identidad del coordinador (del JWT): queda en el evento de auditoría. */
  readonly decidedBy: string;
  /** Capital del préstamo a ofertar (unidades menores). */
  readonly principalMinor: number;
  /** Moneda fijada por el servidor (despliegue), no por el cliente. */
  readonly currency: string;
}

export interface OfferPlansResult {
  readonly planOfferStatus: PlanOfferStatus;
}

/**
 * Caso de uso del "botón azul": el coordinador oferta planes al cliente. Según el toggle del tenant
 * (`clientChoosesPlan`): con autonomía ON envía el menú de planes activos y espera la selección;
 * con OFF toma el plan por defecto, proyecta el cronograma y pide aceptación. Sella el vencimiento
 * de la oferta con el TTL del tenant. No valida HTTP ni arma SQL: orquesta dominio + puertos.
 */
export class OfferPlansHandler {
  constructor(
    private readonly store: PlanOfferStore,
    private readonly plans: PaymentPlanStore,
    private readonly settings: TenantSettingsStore,
    private readonly notifier: PlanOfferNotifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(cmd: OfferPlansCommand): Promise<OfferPlansResult> {
    const snapshot = await this.store.loadOfferSnapshot({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
    });
    if (!snapshot) throw new NotFoundError("El expediente no existe");
    if (snapshot.status !== "IN_REVIEW") {
      throw new ConflictError("Solo se ofertan planes en expedientes en revisión");
    }

    const config = await this.settings.get(cmd.tenantId);
    const now = this.clock();
    const offerExpiresAt = offerExpiryFrom(now, config.planOfferTtlHours);

    if (config.clientChoosesPlan) {
      return this.offerMenu(cmd, snapshot, offerExpiresAt);
    }
    return this.offerDefaultForAcceptance(cmd, snapshot, offerExpiresAt, now);
  }

  /** Toggle ON: envía el menú de planes activos y espera selección del cliente. */
  private async offerMenu(
    cmd: OfferPlansCommand,
    snapshot: PlanOfferSnapshot,
    offerExpiresAt: Date,
  ): Promise<OfferPlansResult> {
    const active = await this.plans.listActive(cmd.tenantId);
    if (active.length === 0) {
      throw new ConflictError("No hay planes activos para ofertar", "NO_ACTIVE_PLANS");
    }

    assertOfferTransition(snapshot.planOffer, "OFFER", "AWAITING_SELECTION");
    await this.store.markOffered({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
      decidedBy: cmd.decidedBy,
      to: "AWAITING_SELECTION",
      offeredPlanId: null,
      offeredPrincipalMinor: cmd.principalMinor,
      offerExpiresAt,
    });
    await this.notifier.sendPlanMenu({
      channelId: snapshot.channelId,
      recipient: snapshot.applicantPhone,
      plans: active,
    });
    return { planOfferStatus: "AWAITING_SELECTION" };
  }

  /** Toggle OFF: toma el plan por defecto, proyecta el cronograma y pide aceptación. */
  private async offerDefaultForAcceptance(
    cmd: OfferPlansCommand,
    snapshot: PlanOfferSnapshot,
    offerExpiresAt: Date,
    now: Date,
  ): Promise<OfferPlansResult> {
    const plan = await this.plans.findDefault(cmd.tenantId);
    if (!plan) throw new ConflictError("No hay plan por defecto configurado", "NO_DEFAULT_PLAN");

    const schedule = projectPlanSchedule({
      principalMinor: cmd.principalMinor,
      currency: cmd.currency,
      plan,
      startDate: now.toISOString().slice(0, 10),
    });

    assertOfferTransition(snapshot.planOffer, "OFFER", "AWAITING_ACCEPTANCE");
    await this.store.markOffered({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
      decidedBy: cmd.decidedBy,
      to: "AWAITING_ACCEPTANCE",
      offeredPlanId: plan.id,
      offeredPrincipalMinor: cmd.principalMinor,
      offerExpiresAt,
    });
    await this.notifier.sendScheduleForAcceptance({
      channelId: snapshot.channelId,
      recipient: snapshot.applicantPhone,
      plan,
      principalMinor: cmd.principalMinor,
      currency: cmd.currency,
      schedule,
    });
    return { planOfferStatus: "AWAITING_ACCEPTANCE" };
  }
}
