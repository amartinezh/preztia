import { randomUUID } from "node:crypto";
import {
  Money,
  NotFoundError,
  buildSchedule,
  nextDecisionStatus,
  scheduleDueDates,
  type ScheduleFrequency,
} from "@preztiaos/domain";

import type { ScheduledInstallment } from "../grant-credit";
import type { ApplicationDecisionStore } from "./ports";

/** Orden del coordinador: aprobar el expediente y otorgar el crédito con estos términos. */
export interface ApproveApplicationReviewCommand {
  readonly tenantId: string;
  readonly applicationId: string;
  /** Identidad del coordinador que decide (del JWT): queda en el audit log. */
  readonly decidedBy: string;
  readonly reason: string;
  readonly borrowerId: string;
  readonly zoneId: string;
  readonly principalMinor: number;
  readonly interestPct: number;
  readonly installmentsCount: number;
  readonly currency: string;
  readonly frequency?: ScheduleFrequency;
  /** Teléfono del deudor; por defecto el del solicitante del expediente. */
  readonly borrowerPhone?: string;
}

export interface ApproveApplicationReviewResult {
  readonly applicationId: string;
  readonly creditId: string;
  readonly status: "APPROVED";
}

/**
 * Caso de uso: el coordinador aprueba —a su discreción— el expediente y se genera el crédito,
 * aunque el pipeline antifraude lo haya marcado. La transición la decide el dominio
 * (`nextDecisionStatus`, que falla con conflicto si ya estaba resuelto); el cronograma se
 * arma con la lógica pura del crédito; la persistencia (estado + auditoría + crédito) es
 * atómica vía el puerto. No valida HTTP, no arma SQL: solo orquesta.
 */
export class ApproveApplicationReviewHandler {
  constructor(
    private readonly store: ApplicationDecisionStore,
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

    const frequency = cmd.frequency ?? "DAILY";
    const principal = Money.of(cmd.principalMinor, cmd.currency);
    const schedule = buildSchedule(principal, cmd.interestPct, cmd.installmentsCount);
    const startDate = this.clock().toISOString().slice(0, 10);
    const dueDates = scheduleDueDates(startDate, frequency, cmd.installmentsCount);
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
      credit: {
        id: creditId,
        tenantId: cmd.tenantId,
        borrowerId: cmd.borrowerId,
        zoneId: cmd.zoneId,
        principalMinor: cmd.principalMinor,
        interestPct: cmd.interestPct,
        installmentsCount: cmd.installmentsCount,
        frequency,
        currency: cmd.currency,
        startDate,
        endDate: dueDates[dueDates.length - 1]!,
      },
      schedule: scheduled,
      // contact solo cuando hay teléfono (exactOptionalPropertyTypes).
      ...(borrowerPhone ? { contact: { phone: borrowerPhone } } : {}),
    });

    return { applicationId: cmd.applicationId, creditId, status: "APPROVED" };
  }
}
