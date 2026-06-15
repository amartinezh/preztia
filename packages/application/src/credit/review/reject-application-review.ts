import { NotFoundError, nextDecisionStatus } from "@preztiaos/domain";

import type { ApplicationDecisionStore } from "./ports";

/** Orden del coordinador: rechazar el expediente (con motivo auditable). */
export interface RejectApplicationReviewCommand {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly decidedBy: string;
  readonly reason: string;
}

export interface RejectApplicationReviewResult {
  readonly applicationId: string;
  readonly status: "REJECTED";
}

/**
 * Caso de uso: el coordinador rechaza el expediente. La transición la decide el dominio
 * (conflicto si ya estaba resuelto hacia otro estado) y la decisión se persiste con su
 * evento de auditoría append-only. El historial de fraude no se altera.
 */
export class RejectApplicationReviewHandler {
  constructor(private readonly store: ApplicationDecisionStore) {}

  async execute(
    cmd: RejectApplicationReviewCommand,
  ): Promise<RejectApplicationReviewResult> {
    const snapshot = await this.store.loadDecisionSnapshot({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
    });
    if (!snapshot) {
      throw new NotFoundError("El expediente no existe");
    }
    nextDecisionStatus(snapshot.status, "REJECT"); // valida la transición

    await this.store.reject({
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
      reason: cmd.reason,
      decidedBy: cmd.decidedBy,
    });

    return { applicationId: cmd.applicationId, status: "REJECTED" };
  }
}
