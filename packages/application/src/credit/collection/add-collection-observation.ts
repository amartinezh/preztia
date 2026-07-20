import { NotFoundError } from "@preztiaos/domain";
import type { CollectionNoteRepository, VisitOverdueReader } from "./visit-ports";

/**
 * Caso de uso: el cobrador agrega una OBSERVACIÓN de visita a un crédito. Verifica que el crédito
 * está en su alcance (asignado a él) y persiste la nota en la bitácora append-only. No calcula
 * reglas de mora ni arma SQL: delega en los puertos. La observación habilita luego "marcar
 * visitado" (debe existir una nota posterior a la última visita).
 */
export class AddCollectionObservationHandler {
  constructor(
    private readonly overdue: VisitOverdueReader,
    private readonly notes: CollectionNoteRepository,
  ) {}

  async execute(input: {
    tenantId: string;
    collectorId: string;
    creditId: string;
    body: string;
  }): Promise<{ id: string }> {
    const snapshot = await this.overdue.findForCollector({
      tenantId: input.tenantId,
      collectorId: input.collectorId,
      creditId: input.creditId,
    });
    if (!snapshot) {
      throw new NotFoundError("El crédito no está en tu cartera de cobro");
    }
    const note = await this.notes.add({
      tenantId: input.tenantId,
      creditId: input.creditId,
      borrowerId: snapshot.borrowerId,
      authorId: input.collectorId,
      body: input.body,
    });
    return { id: note.id };
  }
}
