import { describe, it, expect } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@preztiaos/domain";
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
import {
  ChangeOwnPasswordHandler,
  CreateUserHandler,
  UpdateUserHandler,
} from "./users";
import { CreateZoneHandler } from "./zones";
import {
  AssignCollectorClientsHandler,
  UpdateCollectorClientsHandler,
} from "./collectors";

// Doble determinista: el hash es reconocible y `verify` invierte la misma regla.
const hasher: PasswordHasher = {
  hash: async (p) => `hash:${p}`,
  verify: async (p, h) => h === `hash:${p}`,
};

function adminActor(over: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: "admin-1",
    role: "ADMIN",
    tenantId: "t1",
    zonePaths: [],
    ...over,
  };
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
    displayName?: string | null;
    passwordHash?: string;
  }> = [];
  constructor(
    private readonly byId: Record<string, UserRecord> = {},
    private readonly hashById: Record<string, string> = {},
  ) {}
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
    displayName?: string | null;
    passwordHash?: string;
  }): Promise<UserRecord | null> {
    this.updates.push(input);
    const existing = this.byId[input.userId];
    if (!existing) return null;
    if (input.passwordHash !== undefined) {
      this.hashById[input.userId] = input.passwordHash;
    }
    return {
      ...existing,
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.zonePaths !== undefined ? { zonePaths: input.zonePaths } : {}),
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
    };
  }
  async findById(input: {
    tenantId: string;
    userId: string;
  }): Promise<UserRecord | null> {
    return this.byId[input.userId] ?? null;
  }
  async findCredentials(input: { tenantId: string; userId: string }) {
    const user = this.byId[input.userId];
    const passwordHash = this.hashById[input.userId];
    if (!user || passwordHash === undefined) return null;
    return { passwordHash, active: user.active };
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
    const out = await new CreateTenantHandler(store).execute({
      name: "Acme Microcréditos",
    });
    expect(out.slug).toBe("acme-microcreditos");
    expect(out.id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("CreateTenantAdminHandler", () => {
  const activeTenant: TenantRecord = {
    id: "t1",
    name: "Acme",
    slug: "acme",
    status: "ACTIVE",
  };

  it("provisiona un ADMIN vinculado al tenant destino", async () => {
    const users = new FakeUserStore();
    const tenants: TenantStore = {
      create: async () => undefined,
      update: async () => null,
      remove: async () => false,
      findById: async () => activeTenant,
    };
    const out = await new CreateTenantAdminHandler(
      tenants,
      users,
      hasher,
    ).execute({
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
      new CreateTenantAdminHandler(
        tenants,
        new FakeUserStore(),
        hasher,
      ).execute({
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
      new CreateTenantAdminHandler(
        tenants,
        new FakeUserStore(),
        hasher,
      ).execute({
        tenantId: "t1",
        email: "a@b.test",
        password: "changeme-123",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("UpdateTenantAdminHandler", () => {
  const activeTenant: TenantRecord = {
    id: "t1",
    name: "Acme",
    slug: "acme",
    status: "ACTIVE",
  };
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
    displayName: null,
    role: "ADMIN",
    zonePaths: [],
    active: true,
  };

  it("desactiva un admin sin borrarlo", async () => {
    const users = new FakeUserStore({ u1: adminRecord });
    const out = await new UpdateTenantAdminHandler(
      tenants,
      users,
      hasher,
    ).execute({
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
    const missingTenant: TenantStore = {
      ...tenants,
      findById: async () => null,
    };
    await expect(
      new UpdateTenantAdminHandler(
        missingTenant,
        new FakeUserStore(),
        hasher,
      ).execute({
        tenantId: "missing",
        adminId: "u1",
        active: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no toca usuarios que no son ADMIN del tenant", async () => {
    const users = new FakeUserStore({
      u1: { ...adminRecord, role: "COORDINATOR" },
    });
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
  const activeTenant: TenantRecord = {
    id: "t1",
    name: "Acme",
    slug: "acme",
    status: "ACTIVE",
  };
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

    const report = await new PurgeTenantDataHandler(
      tenantsFound,
      data,
      files,
    ).execute("t1");

    expect(purgedFor).toEqual(["t1"]);
    // INVARIANTE: rowsDeleted === Σ de los conteos por tabla.
    expect(report.rowsDeleted).toBe(10);
    expect(report.filesDeleted).toBe(7);
    expect(report.tables).toEqual({ credit: 3, payment: 5, borrower: 2 });
  });

  it("falla si el tenant no existe y NO purga nada", async () => {
    const missingTenant: TenantStore = {
      ...tenantsFound,
      findById: async () => null,
    };
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
    expect(users.created[0]).toMatchObject({
      role: "COORDINATOR",
      tenantId: "t1",
    });
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

describe("CreateUserHandler (nombre visible)", () => {
  it("propaga el nombre visible y lo deja en null cuando no se indica", async () => {
    const users = new FakeUserStore();
    const handler = new CreateUserHandler(users, hasher);
    await handler.execute({
      actor: adminActor(),
      email: "ana@acme.test",
      password: "changeme-123",
      role: "COLLECTOR",
      zonePaths: [],
      displayName: "Ana Souza",
    });
    await handler.execute({
      actor: adminActor(),
      email: "sin@acme.test",
      password: "changeme-123",
      role: "COLLECTOR",
      zonePaths: [],
    });
    expect(users.created[0]?.displayName).toBe("Ana Souza");
    expect(users.created[1]?.displayName).toBeNull();
  });
});

describe("UpdateUserHandler", () => {
  const collector: UserRecord = {
    id: "cob-1",
    tenantId: "t1",
    email: "cob@acme.test",
    displayName: null,
    role: "COLLECTOR",
    zonePaths: ["co.antioquia.medellin"],
    active: true,
  };

  it("ADMIN restablece la contraseña: se persiste HASHEADA, nunca en claro", async () => {
    const users = new FakeUserStore({ "cob-1": collector });
    await new UpdateUserHandler(users, hasher).execute({
      actor: adminActor(),
      userId: "cob-1",
      password: "nueva-clave-9",
    });
    expect(users.updates[0]?.passwordHash).toBe("hash:nueva-clave-9");
    // Al almacén solo llega el hash: la clave en claro no viaja bajo ninguna llave.
    expect(users.updates[0]).not.toHaveProperty("password");
  });

  it("sin contraseña no toca el hash; actualiza nombre visible (y null lo borra)", async () => {
    const users = new FakeUserStore({ "cob-1": collector });
    const handler = new UpdateUserHandler(users, hasher);
    const renamed = await handler.execute({
      actor: adminActor(),
      userId: "cob-1",
      displayName: "Carlos Cobrador",
    });
    expect(renamed.displayName).toBe("Carlos Cobrador");
    expect(users.updates[0]?.passwordHash).toBeUndefined();
    await handler.execute({ actor: adminActor(), userId: "cob-1", displayName: null });
    expect(users.updates[1]?.displayName).toBeNull();
  });

  it("COORDINATOR restablece la clave de un cobrador DENTRO de su subárbol", async () => {
    const users = new FakeUserStore({ "cob-1": collector });
    await new UpdateUserHandler(users, hasher).execute({
      actor: coordinatorActor(),
      userId: "cob-1",
      password: "nueva-clave-9",
    });
    expect(users.updates[0]?.passwordHash).toBe("hash:nueva-clave-9");
  });

  it("COORDINATOR no gobierna a un cobrador de otra zona ni a un ADMIN", async () => {
    const users = new FakeUserStore({
      "cob-1": { ...collector, zonePaths: ["co.valle.cali"] },
      "adm-1": { ...collector, id: "adm-1", role: "ADMIN", zonePaths: [] },
    });
    const handler = new UpdateUserHandler(users, hasher);
    await expect(
      handler.execute({ actor: coordinatorActor(), userId: "cob-1", password: "nueva-clave-9" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      handler.execute({ actor: coordinatorActor(), userId: "adm-1", active: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(users.updates).toHaveLength(0);
  });

  it("falla con 404 si el usuario no existe en el tenant", async () => {
    await expect(
      new UpdateUserHandler(new FakeUserStore(), hasher).execute({
        actor: adminActor(),
        userId: "nadie",
        active: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ChangeOwnPasswordHandler", () => {
  const me: UserRecord = {
    id: "cob-1",
    tenantId: "t1",
    email: "cob@acme.test",
    displayName: "Ana",
    role: "COLLECTOR",
    zonePaths: ["co.antioquia"],
    active: true,
  };
  const actor: ActorContext = {
    userId: "cob-1",
    role: "COLLECTOR",
    tenantId: "t1",
    zonePaths: ["co.antioquia"],
  };

  it("con la contraseña actual correcta guarda la nueva HASHEADA", async () => {
    const users = new FakeUserStore({ "cob-1": me }, { "cob-1": "hash:vieja-123" });
    await new ChangeOwnPasswordHandler(users, hasher).execute({
      actor,
      currentPassword: "vieja-123",
      newPassword: "nueva-clave-9",
    });
    expect(users.updates).toHaveLength(1);
    expect(users.updates[0]).toMatchObject({ userId: "cob-1", passwordHash: "hash:nueva-clave-9" });
    expect(await users.findCredentials({ tenantId: "t1", userId: "cob-1" })).toEqual({
      passwordHash: "hash:nueva-clave-9",
      active: true,
    });
  });

  it("rechaza la contraseña actual incorrecta SIN tocar el hash", async () => {
    const users = new FakeUserStore({ "cob-1": me }, { "cob-1": "hash:vieja-123" });
    await expect(
      new ChangeOwnPasswordHandler(users, hasher).execute({
        actor,
        currentPassword: "adivinanza",
        newPassword: "nueva-clave-9",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(users.updates).toHaveLength(0);
  });

  it("una cuenta desactivada no cambia su contraseña", async () => {
    const users = new FakeUserStore(
      { "cob-1": { ...me, active: false } },
      { "cob-1": "hash:vieja-123" },
    );
    await expect(
      new ChangeOwnPasswordHandler(users, hasher).execute({
        actor,
        currentPassword: "vieja-123",
        newPassword: "nueva-clave-9",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(users.updates).toHaveLength(0);
  });

  it("falla con 404 si el usuario de la sesión ya no existe", async () => {
    await expect(
      new ChangeOwnPasswordHandler(new FakeUserStore(), hasher).execute({
        actor,
        currentPassword: "vieja-123",
        newPassword: "nueva-clave-9",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
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
      supportPhone: null,
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
    displayName: null,
    role: "COLLECTOR",
    zonePaths: ["co.antioquia"],
    active: true,
  };

  it("reemplaza la cartera del cobrador sin duplicados", async () => {
    const calls: { borrowerIds: readonly string[]; assignedBy: string }[] = [];
    const assignments: CollectorAssignmentStore = {
      replaceAssignments: async (input) => {
        calls.push({
          borrowerIds: input.borrowerIds,
          assignedBy: input.assignedBy,
        });
      },
      updateAssignments: async () => ({ assigned: 0 }),
    };
    const users = new FakeUserStore({ "cob-1": collector });
    const out = await new AssignCollectorClientsHandler(
      assignments,
      users,
    ).execute({
      actor: coordinatorActor(),
      collectorId: "cob-1",
      borrowerIds: ["b1", "b2", "b1"],
    });
    expect(out.assigned).toBe(2);
    expect(calls[0]!.borrowerIds).toEqual(["b1", "b2"]);
    expect(calls[0]!.assignedBy).toBe("coord-1");
  });

  it("rechaza asignar clientes a un usuario que no es cobrador", async () => {
    const users = new FakeUserStore({
      "cob-1": { ...collector, role: "COORDINATOR" },
    });
    await expect(
      new AssignCollectorClientsHandler(
        {
          replaceAssignments: async () => undefined,
          updateAssignments: async () => ({ assigned: 0 }),
        },
        users,
      ).execute({
        actor: coordinatorActor(),
        collectorId: "cob-1",
        borrowerIds: ["b1"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("UpdateCollectorClientsHandler", () => {
  const collector: UserRecord = {
    id: "cob-1",
    tenantId: "t1",
    email: "cob@acme.test",
    displayName: null,
    role: "COLLECTOR",
    zonePaths: ["co.antioquia"],
    active: true,
  };

  /** Doble en memoria: la cartera es un Set; agregar es idempotente y quitar ignora ausentes. */
  class FakeAssignments implements CollectorAssignmentStore {
    readonly portfolio: Set<string>;
    readonly calls: Array<{
      add: readonly string[];
      remove: readonly string[];
      assignedBy: string;
    }> = [];
    constructor(initial: readonly string[] = []) {
      this.portfolio = new Set(initial);
    }
    async replaceAssignments(): Promise<void> {
      throw new Error("no debe reemplazar la cartera");
    }
    async updateAssignments(input: {
      assignedBy: string;
      add: readonly string[];
      remove: readonly string[];
    }): Promise<{ assigned: number }> {
      this.calls.push({
        add: input.add,
        remove: input.remove,
        assignedBy: input.assignedBy,
      });
      for (const id of input.remove) this.portfolio.delete(id);
      for (const id of input.add) this.portfolio.add(id);
      return { assigned: this.portfolio.size };
    }
  }

  it("agrega y quita por deltas sin tocar el resto y devuelve el total resultante", async () => {
    const assignments = new FakeAssignments(["b1", "b2", "b3"]);
    const users = new FakeUserStore({ "cob-1": collector });
    const out = await new UpdateCollectorClientsHandler(
      assignments,
      users,
    ).execute({
      actor: coordinatorActor(),
      collectorId: "cob-1",
      add: ["b4"],
      remove: ["b1"],
    });
    expect(out.assigned).toBe(3);
    expect([...assignments.portfolio]).toEqual(["b2", "b3", "b4"]);
    expect(assignments.calls[0]!.assignedBy).toBe("coord-1");
  });

  it("deduplica cada lista antes de persistir", async () => {
    const assignments = new FakeAssignments();
    const users = new FakeUserStore({ "cob-1": collector });
    await new UpdateCollectorClientsHandler(assignments, users).execute({
      actor: coordinatorActor(),
      collectorId: "cob-1",
      add: ["b1", "b1", "b2"],
      remove: ["b9", "b9"],
    });
    expect(assignments.calls[0]!.add).toEqual(["b1", "b2"]);
    expect(assignments.calls[0]!.remove).toEqual(["b9"]);
  });

  it("rechaza agregar y quitar el mismo cliente en una operación (add ∩ remove = ∅)", async () => {
    const assignments = new FakeAssignments(["b1"]);
    const users = new FakeUserStore({ "cob-1": collector });
    await expect(
      new UpdateCollectorClientsHandler(assignments, users).execute({
        actor: coordinatorActor(),
        collectorId: "cob-1",
        add: ["b1", "b2"],
        remove: ["b1"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Nada se persistió: la orden contradictoria se rechaza completa.
    expect(assignments.calls).toHaveLength(0);
  });

  it("rechaza ajustar la cartera de un usuario que no es cobrador", async () => {
    const users = new FakeUserStore({
      "cob-1": { ...collector, role: "COORDINATOR" },
    });
    await expect(
      new UpdateCollectorClientsHandler(new FakeAssignments(), users).execute({
        actor: coordinatorActor(),
        collectorId: "cob-1",
        add: ["b1"],
        remove: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("falla con 404 si el cobrador no existe en el tenant", async () => {
    await expect(
      new UpdateCollectorClientsHandler(
        new FakeAssignments(),
        new FakeUserStore(),
      ).execute({
        actor: coordinatorActor(),
        collectorId: "nadie",
        add: ["b1"],
        remove: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
