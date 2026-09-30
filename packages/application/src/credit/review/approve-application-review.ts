import { randomUUID } from "node:crypto";
import {
  ConflictError,
  Money,
  NotFoundError,
  buildSchedule,
  nextDecisionStatus,
  scheduleDueDates,
  type Role,
  type ScheduleFrequency,
} from "@preztiaos/domain";

import { assertCreditInterestAllowed } from "../interest-guard";

import {
  assertBorrowerCanReceiveCredit,
  type BorrowerCreditPolicyPort,
  type ScheduledInstallment,
} from "../grant-credit";
import type { PaymentPlanStore } from "../plan/ports";
import type { TenantSettingsStore } from "../../tenant/settings";
import type {
  ApplicationDecisionSnapshot,
  ApplicationDecisionStore,
  CreditRegisteredNotifier,
} from "./ports";

/** Orden del coordinador: aprobar el expediente y otorgar el crédito con estos términos. */
export interface ApproveApplicationReviewCommand {
  readonly tenantId: string;
  readonly applicationId: string;
  /** Identidad del coordinador que decide (del JWT): queda en el audit log. */
  readonly decidedBy: string;
  /** Rol de quien decide (del JWT): decide si puede usar un interés personalizado. */
  readonly decidedByRole: Role;
  readonly reason: string;
  readonly borrowerId: string;
  readonly zoneId: string;
  readonly principalMinor: number;
  readonly interestPct: number;
  readonly installmentsCount: number;
  readonly currency: string;
  readonly frequency?: ScheduleFrequency;
  /** Plan elegido por el coordinador cuando no hubo oferta negociada (fuente del interés). */
  readonly paymentPlanId?: string;
  /** Caja/cuenta de la que sale el dinero del préstamo (asiento DISBURSEMENT atómico). */
  readonly fundingCashBoxId: string;
  /** Teléfono del deudor; por defecto el del solicitante del expediente. */
  readonly borrowerPhone?: string;
}

export interface ApproveApplicationReviewResult {
  readonly applicationId: string;
  readonly creditId: string;
  readonly status: "APPROVED";
}

/** Términos efectivos del crédito (del plan negociado o del comando, según el flujo). */
interface EffectiveTerms {
  readonly principalMinor: number;
  readonly interestPct: number;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly paymentPlanId: string | null;
  /** Los escribió una persona (sin plan negociado): pasan por la guarda del interés. */
  readonly typedByReviewer: boolean;
}

/**
 * Caso de uso: el coordinador aprueba el expediente y se genera el crédito. Si se inyectan los
 * puertos de planes y configuración (Fase 10):
 *  - exige que el cliente haya aceptado por WhatsApp, salvo que el tenant permita override del
 *    administrador (`allowAdminOverride`); el override queda auditado;
 *  - toma los términos del PLAN negociado (no del comando) cuando hubo un plan ofertado y aceptado,
 *    garantizando que el crédito == lo que el cliente aceptó, y graba el `payment_plan_id`.
 * Con configuración y planes, los términos escritos a mano (sin plan negociado) respetan el bloqueo
 * del interés: solo el de un plan activo, salvo la excepción del ADMIN (`assertCreditInterestAllowed`).
 * Con el puerto de política, respeta el cupo y el bloqueo del cliente igual que el otorgamiento
 * directo, evaluados sobre el monto EFECTIVO (el del plan negociado, no el del comando).
 * Sin esos puertos conserva el comportamiento previo (términos del comando; sin guarda). La
 * transición la decide el dominio (`nextDecisionStatus`); la persistencia (estado + auditoría +
 * crédito) es atómica vía el puerto. No valida HTTP ni arma SQL: solo orquesta.
 */
export class ApproveApplicationReviewHandler {
  constructor(
    private readonly store: ApplicationDecisionStore,
    private readonly plans?: PaymentPlanStore,
    private readonly settings?: TenantSettingsStore,
    /** Avisa al cliente por WhatsApp que el crédito quedó registrado (best-effort). */
    private readonly registeredNotifier?: CreditRegisteredNotifier,
    /** Cupo + bloqueo del cliente: la aprobación no puede saltarse la regla de `POST /credits`. */
    private readonly borrowerPolicy?: BorrowerCreditPolicyPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    cmd: ApproveApplicationReviewCommand,
  ): Promise<ApproveApplicationReviewResult> {
    const snapshot = await this.store.loadDecisionSnapshot({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
    });
    if (!snapshot) {
      throw new NotFoundError("El expediente no existe");
    }
    // Valida la transición (lanza ConflictError si ya fue resuelto hacia otro estado).
    nextDecisionStatus(snapshot.status, "APPROVE");

    const accepted = snapshot.planOffer === "ACCEPTED";
    const override = await this.assertAcceptanceOrOverride(cmd.tenantId, accepted);

    const terms = await this.resolveTerms(cmd, snapshot);
    if (terms.typedByReviewer && this.plans && this.settings) {
      await assertCreditInterestAllowed(
        { plans: this.plans, settings: this.settings },
        {
          tenantId: cmd.tenantId,
          actorRole: cmd.decidedByRole,
          interestPct: terms.interestPct,
          paymentPlanId: terms.paymentPlanId,
        },
      );
    }
    if (this.borrowerPolicy) {
      await assertBorrowerCanReceiveCredit(this.borrowerPolicy, {
        tenantId: cmd.tenantId,
        borrowerId: cmd.borrowerId,
        requestedMinor: terms.principalMinor,
      });
    }
    const principal = Money.of(terms.principalMinor, cmd.currency);
    const schedule = buildSchedule(principal, terms.interestPct, terms.installmentsCount);
    const startDate = this.clock().toISOString().slice(0, 10);
    const dueDates = scheduleDueDates(startDate, terms.frequency, terms.installmentsCount);
    const scheduled: ScheduledInstallment[] = schedule.map((installment, idx) => ({
      ...installment,
      dueDate: dueDates[idx]!,
    }));

    const creditId = randomUUID();
    const borrowerPhone = cmd.borrowerPhone ?? snapshot.applicantPhone;

    await this.store.approveAndGrant({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
      reason: cmd.reason,
      decidedBy: cmd.decidedBy,
      fundingCashBoxId: cmd.fundingCashBoxId,
      override,
      credit: {
        id: creditId,
        tenantId: cmd.tenantId,
        borrowerId: cmd.borrowerId,
        zoneId: cmd.zoneId,
        principalMinor: terms.principalMinor,
        interestPct: terms.interestPct,
        installmentsCount: terms.installmentsCount,
        frequency: terms.frequency,
        currency: cmd.currency,
        startDate,
        endDate: dueDates[dueDates.length - 1]!,
        paymentPlanId: terms.paymentPlanId,
      },
      schedule: scheduled,
      // contact solo cuando hay teléfono (exactOptionalPropertyTypes).
      ...(borrowerPhone ? { contact: { phone: borrowerPhone } } : {}),
      // La ubicación compartida por WhatsApp es la evidencia verificada más reciente del
      // domicilio/negocio: pasa a ser la ubicación operativa del cliente (la leen los mapas
      // de cobro). La de la solicitud queda intacta como evidencia de originación.
      ...(snapshot.applicantLocation
        ? { borrowerLocation: snapshot.applicantLocation }
        : {}),
    });

    // El crédito ya está creado y desembolsándose: avisamos al cliente por WhatsApp. Es una cortesía
    // posterior a la transacción; si el envío falla, el adaptador lo absorbe (no revierte el crédito).
    if (this.registeredNotifier && snapshot.channelId && borrowerPhone) {
      await this.registeredNotifier.notifyRegistered({
        tenantId: cmd.tenantId,
        zoneId: cmd.zoneId,
        channelId: snapshot.channelId,
        recipient: borrowerPhone,
      });
    }

    return { applicationId: cmd.applicationId, creditId, status: "APPROVED" };
  }

  /**
   * Si hay configuración (Fase 10): exige aceptación del cliente salvo override permitido.
   * @returns true si la creación es un override (cliente no aceptó); false en caso normal.
   */
  private async assertAcceptanceOrOverride(
    tenantId: string,
    accepted: boolean,
  ): Promise<boolean> {
    if (!this.settings || accepted) return false;
    const config = await this.settings.get(tenantId);
    if (!config.allowAdminOverride) {
      throw new ConflictError("El cliente aún no ha aceptado el crédito por WhatsApp");
    }
    return true; // override del administrador
  }

  /** Términos del plan negociado si lo hubo (fuente única); si no, los del comando. */
  private async resolveTerms(
    cmd: ApproveApplicationReviewCommand,
    snapshot: ApplicationDecisionSnapshot,
  ): Promise<EffectiveTerms> {
    if (this.plans && snapshot.offeredPlanId) {
      const plan = await this.plans.findById({
        tenantId: cmd.tenantId,
        id: snapshot.offeredPlanId,
      });
      if (plan) {
        return {
          principalMinor: snapshot.offeredPrincipalMinor ?? cmd.principalMinor,
          interestPct: plan.interestPct,
          installmentsCount: plan.installmentsCount,
          frequency: plan.frequency,
          paymentPlanId: plan.id,
          typedByReviewer: false,
        };
      }
    }
    // Otorgamiento directo (sin oferta, plan borrado o sin puertos Fase 10): términos del comando.
    return {
      principalMinor: cmd.principalMinor,
      interestPct: cmd.interestPct,
      installmentsCount: cmd.installmentsCount,
      frequency: cmd.frequency ?? "DAILY",
      paymentPlanId: cmd.paymentPlanId ?? null,
      typedByReviewer: true,
    };
  }
}
