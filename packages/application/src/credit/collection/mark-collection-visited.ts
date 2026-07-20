import { assertCanMarkVisited, NotFoundError } from "@preztiaos/domain";
import type {
  CollectionNoteRepository,
  CollectionVisitAuditLog,
  CollectionVisitRepository,
  VisitOverdueReader,
} from "./visit-ports";

/**
 * Caso de uso: el cobrador MARCA un crédito como visitado. Orquesta el snapshot de mora, la última
 * visita y la observación más reciente; la regla (umbral alcanzado + observación nueva + ciclo no
 * cubierto) la decide el dominio (`assertCanMarkVisited`, fallo rápido). Al registrar la visita
 * guarda el nivel de mora del momento (reagendamiento por ciclo) y deja traza en `audit_log`.
 */
export class MarkCollectionVisitedHandler {
  constructor(
    private readonly overdue: VisitOverdueReader,
    private readonly notes: CollectionNoteRepository,
    private readonly visits: CollectionVisitRepository,
    private readonly audit: CollectionVisitAuditLog,
  ) {}

  async execute(input: {
    tenantId: string;
    collectorId: string;
    creditId: string;
    /** Umbral vigente (cuotas vencidas) del tenant, resuelto en la frontera desde tenant_config. */
    threshold: number;
  }): Promise<{ visitId: string; visitedAt: string; overdueCountAtVisit: number }> {
    const snapshot = await this.overdue.findForCollector({
      tenantId: input.tenantId,
      collectorId: input.collectorId,
      creditId: input.creditId,
    });
    if (!snapshot) {
      throw new NotFoundError("El crédito no está en tu cartera de cobro");
    }

    const lastVisit = await this.visits.lastVisit({
      tenantId: input.tenantId,
      creditId: input.creditId,
    });
    const latestNoteAt = await this.notes.latestNoteAt({
      tenantId: input.tenantId,
      creditId: input.creditId,
    });
    // Observación "nueva" = registrada después de la última visita (o cualquiera si nunca se visitó).
    const hasFreshObservation =
      latestNoteAt !== null &&
      (lastVisit === null ||
        Date.parse(latestNoteAt) > Date.parse(lastVisit.visitedAt));

    assertCanMarkVisited({
      overdueCount: snapshot.overdueCount,
      threshold: input.threshold,
      lastVisitOverdueCount: lastVisit?.overdueCountAtVisit ?? null,
      hasFreshObservation,
    });

    const visit = await this.visits.record({
      tenantId: input.tenantId,
      creditId: input.creditId,
      borrowerId: snapshot.borrowerId,
      collectorId: input.collectorId,
      overdueCountAtVisit: snapshot.overdueCount,
      daysOverdueAtVisit: snapshot.daysOverdue,
    });
    await this.audit.recordVisit({
      tenantId: input.tenantId,
      creditId: input.creditId,
      collectorId: input.collectorId,
      overdueCountAtVisit: snapshot.overdueCount,
    });

    return {
      visitId: visit.id,
      visitedAt: visit.visitedAt,
      overdueCountAtVisit: snapshot.overdueCount,
    };
  }
}
