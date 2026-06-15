import {
  ConflictError,
  NotFoundError,
  type Role,
} from "@preztiaos/domain";
import type {
  ActorContext,
  CollectorAssignmentStore,
  UserStore,
} from "./ports";

// Caso de uso: el coordinador asigna a un COBRADOR el conjunto de clientes (deudores) que
// podrá gestionar. El cobrador SOLO verá esos clientes (authZ de aplicación; ver
// clients-query del API). La asignación se reemplaza atómicamente.

const COLLECTOR_ROLE: Role = "COLLECTOR";

export interface AssignCollectorClientsCommand {
  actor: ActorContext;
  collectorId: string;
  /** Conjunto completo de clientes del cobrador tras la operación (reemplazo). */
  borrowerIds: readonly string[];
}

export class AssignCollectorClientsHandler {
  constructor(
    private readonly assignments: CollectorAssignmentStore,
    private readonly users: UserStore,
  ) {}

  async execute(cmd: AssignCollectorClientsCommand): Promise<{ assigned: number }> {
    const collector = await this.users.findById({
      tenantId: cmd.actor.tenantId,
      userId: cmd.collectorId,
    });
    if (!collector) throw new NotFoundError("El cobrador no existe");
    if (collector.role !== COLLECTOR_ROLE) {
      throw new ConflictError("Solo se pueden asignar clientes a un cobrador");
    }
    // Sin duplicados: el conjunto define exactamente la cartera del cobrador.
    const borrowerIds = [...new Set(cmd.borrowerIds)];
    await this.assignments.replaceAssignments({
      tenantId: cmd.actor.tenantId,
      collectorId: cmd.collectorId,
      assignedBy: cmd.actor.userId,
      borrowerIds,
    });
    return { assigned: borrowerIds.length };
  }
}
