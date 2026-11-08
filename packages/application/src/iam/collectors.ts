import { ConflictError, NotFoundError, type Role } from "@preztiaos/domain";
import type {
  ActorContext,
  CollectorAssignmentStore,
  UserRecord,
  UserStore,
} from "./ports";

// Casos de uso de la cartera de un COBRADOR: el coordinador decide qué clientes (deudores) podrá
// gestionar. El cobrador SOLO verá esos clientes (authZ de aplicación; ver clients-query del API).
// Dos gestos: reemplazar la cartera completa, o ajustarla por deltas (agregar/quitar) sin tener
// que cargar toda la cartera en pantalla (hallazgo C8: reemplazar con lo cargado desasignaba en
// silencio a los clientes de las páginas no vistas).

const COLLECTOR_ROLE: Role = "COLLECTOR";

/** El destinatario de la cartera debe existir en el tenant y ser cobrador; si no, se falla rápido. */
async function requireCollector(
  users: UserStore,
  actor: ActorContext,
  collectorId: string,
): Promise<UserRecord> {
  const collector = await users.findById({
    tenantId: actor.tenantId,
    userId: collectorId,
  });
  if (!collector) throw new NotFoundError("El cobrador no existe");
  if (collector.role !== COLLECTOR_ROLE) {
    throw new ConflictError("Solo se pueden asignar clientes a un cobrador");
  }
  return collector;
}

/** Sin duplicados, conservando el orden de llegada. */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

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

  async execute(
    cmd: AssignCollectorClientsCommand,
  ): Promise<{ assigned: number }> {
    await requireCollector(this.users, cmd.actor, cmd.collectorId);
    // Sin duplicados: el conjunto define exactamente la cartera del cobrador.
    const borrowerIds = unique(cmd.borrowerIds);
    await this.assignments.replaceAssignments({
      tenantId: cmd.actor.tenantId,
      collectorId: cmd.collectorId,
      assignedBy: cmd.actor.userId,
      borrowerIds,
    });
    return { assigned: borrowerIds.length };
  }
}

export interface UpdateCollectorClientsCommand {
  actor: ActorContext;
  collectorId: string;
  /** Clientes que se AGREGAN a la cartera (los ya asignados no se duplican). */
  add: readonly string[];
  /** Clientes que se QUITAN de la cartera (los no asignados se ignoran). */
  remove: readonly string[];
}

export class UpdateCollectorClientsHandler {
  constructor(
    private readonly assignments: CollectorAssignmentStore,
    private readonly users: UserStore,
  ) {}

  async execute(
    cmd: UpdateCollectorClientsCommand,
  ): Promise<{ assigned: number }> {
    await requireCollector(this.users, cmd.actor, cmd.collectorId);
    const add = unique(cmd.add);
    const remove = unique(cmd.remove);
    // Invariante: add ∩ remove = ∅. Un mismo cliente en ambas listas es una orden contradictoria;
    // mejor rechazarla que elegir en silencio cuál gana.
    const removed = new Set(remove);
    if (add.some((id) => removed.has(id))) {
      throw new ConflictError(
        "Un cliente no puede agregarse y quitarse en la misma operación",
      );
    }
    return this.assignments.updateAssignments({
      tenantId: cmd.actor.tenantId,
      collectorId: cmd.collectorId,
      assignedBy: cmd.actor.userId,
      add,
      remove,
    });
  }
}
