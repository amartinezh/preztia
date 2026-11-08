import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, networkError } from "../errors";
import {
  discardFailed,
  enqueue,
  flush,
  listOperations,
  registerExecutor,
  retryFailed,
  subscribeOperations,
  type QueuedOperation,
} from "./queue";

// AsyncStorage en memoria: la cola solo necesita get/set/remove sobre una clave. `vi.mock` se
// eleva por encima de los imports, así que la fábrica solo puede referirse a `vi.hoisted`.
const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: async (key: string) => {
      memory.delete(key);
    },
  },
}));
// Sin ruido de logs estructurados en la salida de las pruebas.
vi.mock("../logger", () => {
  const noop = () => {};
  return { logger: { debug: noop, info: noop, warn: noop, error: noop } };
});

const STORAGE_KEY = "preztia.offlineQueue.v1";

const conflict = () => new ApiError({ status: 409, messageKey: "errors.conflict" });

// Cada prueba usa un `kind` propio: el registro de ejecutores es de módulo.
let seq = 0;
const nextKind = () => `kind-${++seq}`;

beforeEach(() => {
  memory.clear();
});

describe("cola offline: formato persistido", () => {
  it("migra el array plano anterior a { pending, failed } sin perder operaciones", async () => {
    const legacy: QueuedOperation[] = [
      { id: "a", kind: "k", idempotencyKey: "i-a", payload: { creditId: "c1" }, createdAt: "2026-01-01T00:00:00Z", attempts: 2 },
    ];
    memory.set(STORAGE_KEY, JSON.stringify(legacy));
    await expect(listOperations()).resolves.toEqual({ pending: legacy, failed: [] });
  });

  it("un contenido ilegible se trata como cola vacía", async () => {
    memory.set(STORAGE_KEY, "{no es json");
    await expect(listOperations()).resolves.toEqual({ pending: [], failed: [] });
  });
});

describe("cola offline: barrido", () => {
  it("un rechazo 4xx pasa a `failed` con su motivo y se cuenta como dropped", async () => {
    const kind = nextKind();
    registerExecutor(kind, async () => {
      throw conflict();
    });
    const op = await enqueue(kind, { creditId: "c1", amountMinor: 5000 }, "idem-1");

    const result = await flush();
    expect(result).toEqual({ processed: 0, dropped: 1, remaining: 0 });

    const { pending, failed } = await listOperations();
    expect(pending).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ id: op.id, idempotencyKey: "idem-1", reason: "errors.conflict" });
    expect(typeof failed[0]!.failedAt).toBe("string");
  });

  it("un fallo de red conserva la operación en pending, suma un intento y detiene el barrido", async () => {
    const kind = nextKind();
    registerExecutor(kind, async () => {
      throw networkError(false);
    });
    await enqueue(kind, { creditId: "c1" });
    await enqueue(kind, { creditId: "c2" });

    const result = await flush();
    expect(result).toEqual({ processed: 0, dropped: 0, remaining: 2 });
    const { pending, failed } = await listOperations();
    expect(pending.map((op) => op.attempts)).toEqual([1, 0]);
    expect(failed).toEqual([]);
  });

  it("las enviadas salen de la cola con la misma clave de idempotencia", async () => {
    const kind = nextKind();
    const seen: string[] = [];
    registerExecutor(kind, async (op) => {
      seen.push(op.idempotencyKey);
    });
    await enqueue(kind, {}, "idem-x");
    await expect(flush()).resolves.toEqual({ processed: 1, dropped: 0, remaining: 0 });
    expect(seen).toEqual(["idem-x"]);
  });
});

describe("cola offline: reintentar y descartar rechazadas", () => {
  it("retryFailed devuelve la operación a pending (misma clave, intentos en cero)", async () => {
    const kind = nextKind();
    let fail = true;
    registerExecutor(kind, async () => {
      if (fail) throw conflict();
    });
    const op = await enqueue(kind, { creditId: "c1" }, "idem-r");
    await flush();

    await retryFailed(op.id);
    const after = await listOperations();
    expect(after.failed).toEqual([]);
    expect(after.pending).toHaveLength(1);
    expect(after.pending[0]).toMatchObject({ id: op.id, idempotencyKey: "idem-r", attempts: 0 });
    expect(after.pending[0]).not.toHaveProperty("reason");

    fail = false;
    await expect(flush()).resolves.toEqual({ processed: 1, dropped: 0, remaining: 0 });
  });

  it("discardFailed elimina solo la rechazada indicada", async () => {
    const kind = nextKind();
    registerExecutor(kind, async () => {
      throw conflict();
    });
    const a = await enqueue(kind, { creditId: "a" });
    const b = await enqueue(kind, { creditId: "b" });
    await flush();

    await discardFailed(a.id);
    const { failed } = await listOperations();
    expect(failed.map((op) => op.id)).toEqual([b.id]);
  });

  it("notifica a los suscriptores el estado completo en cada cambio", async () => {
    const kind = nextKind();
    registerExecutor(kind, async () => {
      throw conflict();
    });
    const states: { pending: number; failed: number }[] = [];
    const unsubscribe = subscribeOperations((s) => states.push({ pending: s.pending.length, failed: s.failed.length }));

    const op = await enqueue(kind, {});
    await flush();
    await retryFailed(op.id);
    await discardFailed("inexistente");
    unsubscribe();

    expect(states).toEqual([
      { pending: 1, failed: 0 }, // enqueue
      { pending: 0, failed: 1 }, // flush: rechazada
      { pending: 1, failed: 0 }, // retryFailed
    ]);
  });
});
