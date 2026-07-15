import { randomUUID } from "node:crypto";
import {
  ConflictError,
  NotFoundError,
  buildChildPath,
  toLabel,
} from "@preztiaos/domain";
import type { ActorContext, UserStore, ZoneRecord, ZoneStore } from "./ports";

// Casos de uso del PLANO DE DATOS para el árbol de zonas (ltree). El dominio construye y
// valida los paths; la persistencia (GiST, RLS) es infraestructura. La gestión de zonas
// es del ADMIN (lo filtra `requireRole` en el controlador).

export interface CreateZoneCommand {
  actor: ActorContext;
  name: string;
  /** Zona padre; `null` para una zona raíz. */
  parentZoneId: string | null;
  /** Teléfono de atención al cliente de la zona; `null` si no se configura. */
  supportPhone?: string | null;
}

export class CreateZoneHandler {
  constructor(private readonly zones: ZoneStore) {}

  async execute(cmd: CreateZoneCommand): Promise<{ id: string; path: string }> {
    let parentPath: string | null = null;
    if (cmd.parentZoneId !== null) {
      const parent = await this.zones.findById({
        tenantId: cmd.actor.tenantId,
        zoneId: cmd.parentZoneId,
      });
      if (!parent) throw new NotFoundError("La zona padre no existe");
      parentPath = parent.path;
    }
    const path = buildChildPath(parentPath, toLabel(cmd.name));
    const id = randomUUID();
    await this.zones.create({
      id,
      tenantId: cmd.actor.tenantId,
      parentZoneId: cmd.parentZoneId,
      path,
      name: cmd.name.trim(),
      supportPhone: cmd.supportPhone ?? null,
    });
    return { id, path };
  }
}

export interface UpdateZoneCommand {
  actor: ActorContext;
  zoneId: string;
  name: string;
  /** `undefined` conserva el teléfono actual; `null`/string lo actualiza. */
  supportPhone?: string | null;
}

export class UpdateZoneHandler {
  constructor(private readonly zones: ZoneStore) {}

  async execute(cmd: UpdateZoneCommand): Promise<ZoneRecord> {
    // Solo se renombra y/o ajusta el teléfono de atención: el path es estable para no invalidar
    // las asignaciones existentes.
    const updated = await this.zones.update({
      tenantId: cmd.actor.tenantId,
      zoneId: cmd.zoneId,
      name: cmd.name.trim(),
      // Solo se pasa cuando viene en el comando (undefined ⇒ conserva el valor actual).
      ...(cmd.supportPhone !== undefined ? { supportPhone: cmd.supportPhone } : {}),
    });
    if (!updated) throw new NotFoundError("La zona no existe");
    return updated;
  }
}

export class DeleteZoneHandler {
  constructor(private readonly zones: ZoneStore) {}

  async execute(input: { tenantId: string; zoneId: string }): Promise<void> {
    const result = await this.zones.remove(input);
    if (result.hasChildren) {
      throw new ConflictError("No se puede eliminar una zona con subzonas");
    }
    if (!result.deleted) throw new NotFoundError("La zona no existe");
  }
}

export interface AssignCoordinatorCommand {
  actor: ActorContext;
  zoneId: string;
  coordinatorId: string;
}

export class AssignCoordinatorHandler {
  constructor(
    private readonly zones: ZoneStore,
    private readonly users: UserStore,
  ) {}

  async execute(cmd: AssignCoordinatorCommand): Promise<void> {
    const zone = await this.zones.findById({
      tenantId: cmd.actor.tenantId,
      zoneId: cmd.zoneId,
    });
    if (!zone) throw new NotFoundError("La zona no existe");
    const user = await this.users.findById({
      tenantId: cmd.actor.tenantId,
      userId: cmd.coordinatorId,
    });
    if (!user) throw new NotFoundError("El usuario no existe");
    if (user.role !== "COORDINATOR") {
      throw new ConflictError("Solo un coordinador puede asignarse a una zona");
    }
    await this.zones.assignCoordinator({
      tenantId: cmd.actor.tenantId,
      zoneId: cmd.zoneId,
      coordinatorId: cmd.coordinatorId,
    });
  }
}
