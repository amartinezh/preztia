import { randomUUID } from "node:crypto";
import {
  ConflictError,
  NotFoundError,
  assertValidTenantSlug,
  toTenantSlug,
  type TenantStatus,
} from "@preztiaos/domain";
import type {
  PasswordHasher,
  TenantRecord,
  TenantStore,
  UserStore,
} from "./ports";

// Casos de uso del PLANO DE CONTROL (SUPER_ADMIN). Orquestan el dominio (slug/estado) y
// los puertos de tenants/usuarios; la transacción y el BYPASSRLS los pone la infraestructura.

export interface CreateTenantCommand {
  name: string;
  /** Slug opcional; si falta se deriva del nombre. */
  slug?: string;
}

export class CreateTenantHandler {
  constructor(private readonly tenants: TenantStore) {}

  async execute(cmd: CreateTenantCommand): Promise<{ id: string; slug: string }> {
    const slug = cmd.slug ? cmd.slug : toTenantSlug(cmd.name);
    assertValidTenantSlug(slug);
    const id = randomUUID();
    await this.tenants.create({ id, name: cmd.name.trim(), slug });
    return { id, slug };
  }
}

export interface UpdateTenantCommand {
  id: string;
  name?: string;
  status?: TenantStatus;
}

export class UpdateTenantHandler {
  constructor(private readonly tenants: TenantStore) {}

  async execute(cmd: UpdateTenantCommand): Promise<TenantRecord> {
    const updated = await this.tenants.update({
      id: cmd.id,
      ...(cmd.name !== undefined ? { name: cmd.name.trim() } : {}),
      ...(cmd.status !== undefined ? { status: cmd.status } : {}),
    });
    if (!updated) throw new NotFoundError("El tenant no existe");
    return updated;
  }
}

export class DeleteTenantHandler {
  constructor(private readonly tenants: TenantStore) {}

  async execute(id: string): Promise<void> {
    const deleted = await this.tenants.remove(id);
    if (!deleted) throw new NotFoundError("El tenant no existe");
  }
}

export interface CreateTenantAdminCommand {
  /** Tenant destino al que se vincula el admin. */
  tenantId: string;
  email: string;
  password: string;
}

/**
 * Provisiona un ADMIN para un tenant existente. Es la única vía de alta de admins: el
 * SUPER_ADMIN nunca crea un usuario sin tenant. Falla rápido si el tenant no existe.
 */
export class CreateTenantAdminHandler {
  constructor(
    private readonly tenants: TenantStore,
    private readonly users: UserStore,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(cmd: CreateTenantAdminCommand): Promise<{ id: string }> {
    const tenant = await this.tenants.findById(cmd.tenantId);
    if (!tenant) throw new NotFoundError("El tenant no existe");
    if (tenant.status !== "ACTIVE") {
      throw new ConflictError("No se puede provisionar un admin en un tenant suspendido");
    }
    const id = randomUUID();
    await this.users.create({
      id,
      tenantId: cmd.tenantId,
      email: cmd.email.trim().toLowerCase(),
      passwordHash: await this.hasher.hash(cmd.password),
      role: "ADMIN",
      zonePaths: [],
    });
    return { id };
  }
}
