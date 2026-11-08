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

/**
 * Un actor que no es ADMIN solo gobierna a los usuarios que él mismo podría haber creado
 * (jerarquía de provisión) y que viven en su subárbol de zonas. Así un COORDINATOR restablece la
 * contraseña de SU cobrador, pero nunca la de un ADMIN ni la de un cobrador de otra zona.
 */
function assertUserWithinActorAuthority(actor: ActorContext, target: UserRecord): void {
  if (actor.role === "ADMIN") return;
  const governsRole = canCreateRole(actor.role, target.role);
  const governsZones = allWithinScope(target.zonePaths, actor.zonePaths);
  if (!governsRole || !governsZones) {
    throw new ForbiddenError("Ese usuario está fuera de tu alcance");
  }
}

export interface CreateUserCommand {
  actor: ActorContext;
  email: string;
  password: string;
  role: Role;
  zonePaths: readonly string[];
  displayName?: string | null;
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
      displayName: cmd.displayName ?? null,
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
  /** `undefined` conserva el nombre actual; `null` lo borra. */
  displayName?: string | null;
  /** Nueva contraseña EN CLARO (viene validada del contrato): se hashea aquí, nunca se persiste ni se registra. */
  password?: string;
}

export class UpdateUserHandler {
  constructor(
    private readonly users: UserStore,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(cmd: UpdateUserCommand): Promise<UserRecord> {
    const target = await this.users.findById({
      tenantId: cmd.actor.tenantId,
      userId: cmd.userId,
    });
    if (!target) throw new NotFoundError("El usuario no existe");
    assertUserWithinActorAuthority(cmd.actor, target);
    if (cmd.zonePaths !== undefined) {
      assertZonesWithinActorScope(cmd.actor, cmd.zonePaths);
    }
    const passwordHash = cmd.password ? await this.hasher.hash(cmd.password) : undefined;
    const updated = await this.users.update({
      tenantId: cmd.actor.tenantId,
      userId: cmd.userId,
      ...(cmd.zonePaths !== undefined ? { zonePaths: cmd.zonePaths } : {}),
      ...(cmd.active !== undefined ? { active: cmd.active } : {}),
      ...(cmd.displayName !== undefined ? { displayName: cmd.displayName } : {}),
      ...(passwordHash !== undefined ? { passwordHash } : {}),
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

export interface ChangeOwnPasswordCommand {
  actor: ActorContext;
  currentPassword: string;
  newPassword: string;
}

/**
 * Cambio de la PROPIA contraseña: exige la actual como prueba de posesión (una sesión robada no
 * basta para apropiarse de la cuenta). La frontera ya garantizó que la nueva es distinta y cumple
 * el mínimo. Ninguna contraseña en claro sale de este caso de uso.
 */
export class ChangeOwnPasswordHandler {
  constructor(
    private readonly users: UserStore,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(cmd: ChangeOwnPasswordCommand): Promise<void> {
    const credentials = await this.users.findCredentials({
      tenantId: cmd.actor.tenantId,
      userId: cmd.actor.userId,
    });
    if (!credentials) throw new NotFoundError("El usuario no existe");
    if (!credentials.active) throw new ForbiddenError("La cuenta está desactivada");
    const matches = await this.hasher.verify(cmd.currentPassword, credentials.passwordHash);
    if (!matches) throw new ForbiddenError("La contraseña actual no es correcta");
    const updated = await this.users.update({
      tenantId: cmd.actor.tenantId,
      userId: cmd.actor.userId,
      passwordHash: await this.hasher.hash(cmd.newPassword),
    });
    if (!updated) throw new NotFoundError("El usuario no existe");
  }
}
