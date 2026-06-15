import { randomUUID } from "node:crypto";
import {
  ForbiddenError,
  NotFoundError,
  allWithinScope,
  assertValidPath,
  canCreateRole,
  type Role,
} from "@preztiaos/domain";
import type { ActorContext, PasswordHasher, UserRecord, UserStore } from "./ports";

// Casos de uso del PLANO DE DATOS para usuarios del tenant. La jerarquía de provisión y
// el alcance por zonas se validan aquí (defensa en profundidad); el controlador ya filtró
// el rol del actor con `requireRole`. Toda escritura ocurre con el tenant del ACTOR.

/** Valida que las zonas existan como paths ltree y caigan en el alcance del actor. */
function assertZonesWithinActorScope(
  actor: ActorContext,
  zonePaths: readonly string[],
): void {
  for (const path of zonePaths) assertValidPath(path);
  // El ADMIN gobierna todo su tenant; el COORDINATOR solo asigna dentro de su subárbol.
  if (actor.role !== "ADMIN" && !allWithinScope(zonePaths, actor.zonePaths)) {
    throw new ForbiddenError("Las zonas asignadas exceden tu alcance");
  }
}

export interface CreateUserCommand {
  actor: ActorContext;
  email: string;
  password: string;
  role: Role;
  zonePaths: readonly string[];
}

export class CreateUserHandler {
  constructor(
    private readonly users: UserStore,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(cmd: CreateUserCommand): Promise<{ id: string }> {
    // El actor solo puede crear roles por debajo del suyo (sin escalar privilegios).
    if (!canCreateRole(cmd.actor.role, cmd.role)) {
      throw new ForbiddenError("No puedes crear un usuario con ese rol");
    }
    assertZonesWithinActorScope(cmd.actor, cmd.zonePaths);
    const id = randomUUID();
    await this.users.create({
      id,
      tenantId: cmd.actor.tenantId,
      email: cmd.email.trim().toLowerCase(),
      passwordHash: await this.hasher.hash(cmd.password),
      role: cmd.role,
      zonePaths: cmd.zonePaths,
    });
    return { id };
  }
}

export interface UpdateUserCommand {
  actor: ActorContext;
  userId: string;
  zonePaths?: readonly string[];
  active?: boolean;
}

export class UpdateUserHandler {
  constructor(private readonly users: UserStore) {}

  async execute(cmd: UpdateUserCommand): Promise<UserRecord> {
    if (cmd.zonePaths !== undefined) {
      assertZonesWithinActorScope(cmd.actor, cmd.zonePaths);
    }
    const updated = await this.users.update({
      tenantId: cmd.actor.tenantId,
      userId: cmd.userId,
      ...(cmd.zonePaths !== undefined ? { zonePaths: cmd.zonePaths } : {}),
      ...(cmd.active !== undefined ? { active: cmd.active } : {}),
    });
    if (!updated) throw new NotFoundError("El usuario no existe");
    return updated;
  }
}

export class DeactivateUserHandler {
  constructor(private readonly users: UserStore) {}

  async execute(input: { tenantId: string; userId: string }): Promise<void> {
    const updated = await this.users.update({
      tenantId: input.tenantId,
      userId: input.userId,
      active: false,
    });
    if (!updated) throw new NotFoundError("El usuario no existe");
  }
}
