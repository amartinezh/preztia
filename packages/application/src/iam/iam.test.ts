import { describe, it, expect } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError } from "@preztiaos/domain";
import type {
  ActorContext,
  CollectorAssignmentStore,
  NewUser,
  PasswordHasher,
  TenantRecord,
  TenantStore,
  UserRecord,
  UserStore,
  ZoneRecord,
  ZoneStore,
} from "./ports";
import type { TenantDataPurger, TenantFilePurger } from "./ports";
import {
  CreateTenantHandler,
  CreateTenantAdminHandler,
  PurgeTenantDataHandler,
  UpdateTenantAdminHandler,
} from "./tenants";
import { CreateUserHandler } from "./users";
import { CreateZoneHandler } from "./zones";
import { AssignCollectorClientsHandler } from "./collectors";

const hasher: PasswordHasher = { hash: async (p) => `hash:${p}` };

function adminActor(over: Partial<ActorContext> = {}): ActorContext {
  return { userId: "admin-1", role: "ADMIN", tenantId: "t1", zonePaths: [], ...over };
}
function coordinatorActor(over: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: "coord-1",
    role: "COORDINATOR",
    tenantId: "t1",
    zonePaths: ["co.antioquia"],
    ...over,
  };
}

class FakeUserStore implements UserStore {
  readonly created: NewUser[] = [];
  readonly updates: Array<{
    tenantId: string;
    userId: string;
    zonePaths?: readonly string[];
    active?: boolean;
    passwordHash?: string;
  }> = [];
  constructor(private readonly byId: Record<string, UserRecord> = {}) {}
  async create(user: NewUser): Promise<void> {
    if (this.created.some((u) => u.email === user.email)) {
      throw new ConflictError("email duplicado");
    }
    this.created.push(user);
  }
  async update(input: {
    tenantId: string;
    userId: string;
    zonePaths?: readonly string[];
    active?: boolean;
    passwordHash?: string;
  }): Promise<UserRecord | null> {
    this.updates.push(input);
    const existing = this.byId[input.userId];
    if (!existing) return null;
    return {
      ...existing,
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.zonePaths !== undefined ? { zonePaths: input.zonePaths } : {}),
    };
  }
  async findById(input: { tenantId: string; userId: string }): Promise<UserRecord | null> {
    return this.byId[input.userId] ?? null;
  }
}

describe("CreateTenantHandler", () => {
  it("deriva el slug del nombre y crea el tenant", async () => {
    const store: TenantStore = {
      create: async () => undefined,
      update: async () => null,
      remove: async () => false,
      findById: async () => null,
    };
    const out = await new CreateTenantHandler(store).execute({ name: "Acme Microcréditos" });
    expect(out.slug).toBe("acme-microcreditos");
    expect(out.id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("CreateTenantAdminHandler", () => {
  const activeTenant: TenantRecord = { id: "t1", name: "Acme", slug: "acme", status: "ACTIVE" };

  it("provisiona un ADMIN vinculado al tenant destino", async () => {
    const users = new FakeUserStore();
    const tenants: TenantStore = {
      create: async () => undefined,
      update: async () => null,
      remove: async () => false,
      findById: async () => activeTenant,
    };
    const out = await new CreateTenantAdminHandler(tenants, users, hasher).execute({
      tenantId: "t1",
      email: "Admin@Acme.test",
      password: "changeme-123",
    });
    expect(out.id).toMatch(/[0-9a-f-]{36}/);
    expect(users.created[0]).toMatchObject({
      tenantId: "t1",
      role: "ADMIN",
      email: "admin@acme.test",
    });
  });

  it("falla si el tenant no existe", async () => {
    const tenants: TenantStore = {
      create: async () => undefined,
      update: async () => null,
      remove: async () => false,
      findById: async () => null,
    };
    await expect(
      new CreateTenantAdminHandler(tenants, new FakeUserStore(), hasher).execute({
        tenantId: "missing",
        email: "a@b.test",
        password: "changeme-123",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no provisiona admins en un tenant suspendido", async () => {
    const tenants: TenantStore = {
      create: async () => undefined,
      update: async () => null,
      remove: async () => false,
      findById: async () => ({ ...activeTenant, status: "SUSPENDED" }),
    };
    await expect(
      new CreateTenantAdminHandler(tenants, new FakeUserStore(), hasher).execute({
        tenantId: "t1",
        email: "a@b.test",
        password: "changeme-123",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("UpdateTenantAdminHandler", () => {
  const activeTenant: TenantRecord = { id: "t1", name: "Acme", slug: "acme", status: "ACTIVE" };
  const tenants: TenantStore = {
    create: async () => undefined,
    update: async () => null,
    remove: async () => false,
    findById: async () => activeTenant,
  };
  const adminRecord: UserRecord = {
    id: "u1",
    tenantId: "t1",
    email: "admin@acme.test",
    role: "ADMIN",
    zonePaths: [],
    active: true,
  };

  it("desactiva un admin sin borrarlo", async () => {
    const users = new FakeUserStore({ u1: adminRecord });
    const out = await new UpdateTenantAdminHandler(tenants, users, hasher).execute({
      tenantId: "t1",
      adminId: "u1",
      active: false,
    });
    expect(out).toEqual({ id: "u1", email: "admin@acme.test", active: false });
    expect(users.updates[0]).toMatchObject({ userId: "u1", active: false });
    expect(users.updates[0]?.passwordHash).toBeUndefined();
  });

  it("restablece la contraseña hasheándola antes de persistir", async () => {
    const users = new FakeUserStore({ u1: adminRecord });
    await new UpdateTenantAdminHandler(tenants, users, hasher).execute({
      tenantId: "t1",
      adminId: "u1",
      password: "new-password-9",
    });
    expect(users.updates[0]?.passwordHash).toBe("hash:new-password-9");
  });

  it("falla si el tenant no existe", async () => {
    const missingTenant: TenantStore = { ...tenants, findById: async () => null };
    await expect(
      new UpdateTenantAdminHandler(missingTenant, new FakeUserStore(), hasher).execute({
        tenantId: "missing",
        adminId: "u1",
        active: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no toca usuarios que no son ADMIN del tenant", async () => {
    const users = new FakeUserStore({ u1: { ...adminRecord, role: "COORDINATOR" } });
    await expect(
      new UpdateTenantAdminHandler(tenants, users, hasher).execute({
        tenantId: "t1",
        adminId: "u1",
        active: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(users.updates).toHaveLength(0);
  });
});

describe("PurgeTenantDataHandler", () => {
  const activeTenant: TenantRecord = { id: "t1", name: "Acme", slug: "acme", status: "ACTIVE" };
  const tenantsFound: TenantStore = {
    create: async () => undefined,
    update: async () => null,
    remove: async () => false,
    findById: async () => activeTenant,
  };

  it("purga datos + archivos y reporta la suma de filas borradas", async () => {
    const purgedFor: string[] = [];
    const data: TenantDataPurger = {
      purge: async (id) => {
        purgedFor.push(id);
        return { credit: 3, payment: 5, borrower: 2 };
      },
    };
    const files: TenantFilePurger = { purge: async () => 7 };

    const report = await new PurgeTenantDataHandler(tenantsFound, data, files).execute("t1");

    expect(purgedFor).toEqual(["t1"]);
    // INVARIANTE: rowsDeleted === Σ de los conteos por tabla.
    expect(report.rowsDeleted).toBe(10);
    expect(report.filesDeleted).toBe(7);
    expect(report.tables).toEqual({ credit: 3, payment: 5, borrower: 2 });
  });

  it("falla si el tenant no existe y NO purga nada", async () => {
    const missingTenant: TenantStore = { ...tenantsFound, findById: async () => null };
    const data: TenantDataPurger = {
      purge: async () => {
        throw new Error("no debería llamarse");
      },
    };
    const files: TenantFilePurger = {
      purge: async () => {
        throw new Error("no debería llamarse");
      },
    };
    await expect(
      new PurgeTenantDataHandler(missingTenant, data, files).execute("missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CreateUserHandler", () => {
  it("ADMIN crea un COORDINATOR con cualquier zona del tenant", async () => {
    const users = new FakeUserStore();
    await new CreateUserHandler(users, hasher).execute({
      actor: adminActor(),
      email: "c@acme.test",
      password: "changeme-123",
      role: "COORDINATOR",
      zonePaths: ["co.valle"],
    });
    expect(users.created[0]).toMatchObject({ role: "COORDINATOR", tenantId: "t1" });
  });

  it("COORDINATOR crea un COBRADOR dentro de su subárbol", async () => {
    const users = new FakeUserStore();
    await new CreateUserHandler(users, hasher).execute({
      actor: coordinatorActor(),
      email: "cob@acme.test",
      password: "changeme-123",
      role: "COLLECTOR",
      zonePaths: ["co.antioquia.medellin"],
    });
    expect(users.created[0]).toMatchObject({ role: "COLLECTOR" });
  });

  it("rechaza escalar privilegios (COORDINATOR creando ADMIN)", async () => {
    await expect(
      new CreateUserHandler(new FakeUserStore(), hasher).execute({
        actor: coordinatorActor(),
        email: "x@acme.test",
        password: "changeme-123",
        role: "ADMIN",
        zonePaths: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rechaza asignar zonas fuera del alcance del coordinador", async () => {
    await expect(
      new CreateUserHandler(new FakeUserStore(), hasher).execute({
        actor: coordinatorActor(),
        email: "y@acme.test",
        password: "changeme-123",
        role: "COLLECTOR",
        zonePaths: ["co.valle.cali"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("CreateZoneHandler", () => {
  function zoneStore(parent: ZoneRecord | null): ZoneStore {
    return {
      create: async () => undefined,
      update: async () => null,
      remove: async () => ({ deleted: true, hasChildren: false }),
      findById: async () => parent,
      assignCoordinator: async () => undefined,
    };
  }

  it("crea una zona raíz con su propio label como path", async () => {
    const out = await new CreateZoneHandler(zoneStore(null)).execute({
      actor: adminActor(),
      name: "Antioquia",
      parentZoneId: null,
    });
    expect(out.path).toBe("antioquia");
  });

  it("encadena el path bajo la zona padre", async () => {
    const parent: ZoneRecord = {
      id: "z-parent",
      tenantId: "t1",
      parentZoneId: null,
      path: "co.antioquia",
      name: "Antioquia",
    };
    const out = await new CreateZoneHandler(zoneStore(parent)).execute({
      actor: adminActor(),
      name: "Medellín",
      parentZoneId: "z-parent",
    });
    expect(out.path).toBe("co.antioquia.medellin");
  });

  it("falla si la zona padre no existe", async () => {
    await expect(
      new CreateZoneHandler(zoneStore(null)).execute({
        actor: adminActor(),
        name: "Huérfana",
        parentZoneId: "missing",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AssignCollectorClientsHandler", () => {
  const collector: UserRecord = {
    id: "cob-1",
    tenantId: "t1",
    email: "cob@acme.test",
    role: "COLLECTOR",
    zonePaths: ["co.antioquia"],
    active: true,
  };

  it("reemplaza la cartera del cobrador sin duplicados", async () => {
    const calls: { borrowerIds: readonly string[]; assignedBy: string }[] = [];
    const assignments: CollectorAssignmentStore = {
      replaceAssignments: async (input) => {
        calls.push({ borrowerIds: input.borrowerIds, assignedBy: input.assignedBy });
      },
    };
    const users = new FakeUserStore({ "cob-1": collector });
    const out = await new AssignCollectorClientsHandler(assignments, users).execute({
      actor: coordinatorActor(),
      collectorId: "cob-1",
      borrowerIds: ["b1", "b2", "b1"],
    });
    expect(out.assigned).toBe(2);
    expect(calls[0]!.borrowerIds).toEqual(["b1", "b2"]);
    expect(calls[0]!.assignedBy).toBe("coord-1");
  });

  it("rechaza asignar clientes a un usuario que no es cobrador", async () => {
    const users = new FakeUserStore({ "cob-1": { ...collector, role: "COORDINATOR" } });
    await expect(
      new AssignCollectorClientsHandler(
        { replaceAssignments: async () => undefined },
        users,
      ).execute({ actor: coordinatorActor(), collectorId: "cob-1", borrowerIds: ["b1"] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
