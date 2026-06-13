import AsyncStorage from "@react-native-async-storage/async-storage";

import { logger } from "../logger";
import { newIdempotencyKey } from "../ids";
import { isApiError } from "../errors";

/**
 * Cola de mutaciones para operar sin conexión (cobradores en ruta).
 *
 * Cada operación encolada guarda su `Idempotency-Key` ASÍ que al reintentarse (al recuperar
 * red) el backend la reconoce y no produce doble abono (§3.7 confiabilidad). La cola es
 * agnóstica del dominio: ejecuta operaciones por `kind` usando ejecutores registrados.
 */

const STORAGE_KEY = "preztia.offlineQueue.v1";

export type QueuedOperation = {
  id: string;
  kind: string;
  idempotencyKey: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
};

/** Ejecuta una operación encolada. Debe lanzar si falla (para que permanezca en cola). */
export type Executor = (op: QueuedOperation) => Promise<void>;

const executors = new Map<string, Executor>();

export function registerExecutor(kind: string, executor: Executor) {
  executors.set(kind, executor);
}

async function readAll(): Promise<QueuedOperation[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedOperation[];
  } catch {
    return [];
  }
}

async function writeAll(ops: QueuedOperation[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
}

/**
 * Encola una operación y devuelve su clave de idempotencia (estable para reintentos).
 * Si la operación ya se intentó en línea, se pasa `idempotencyKey` para que el reenvío
 * use la MISMA clave y el backend la deduplique (sin doble abono).
 */
export async function enqueue(
  kind: string,
  payload: unknown,
  idempotencyKey?: string,
): Promise<QueuedOperation> {
  const op: QueuedOperation = {
    id: newIdempotencyKey(),
    kind,
    idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const ops = await readAll();
  ops.push(op);
  await writeAll(ops);
  logger.info("offline_enqueued", {}, { kind, id: op.id });
  return op;
}

export async function pendingCount(): Promise<number> {
  return (await readAll()).length;
}

let flushing = false;

/**
 * Procesa la cola en orden. Una operación se elimina si su ejecutor tiene éxito o si falla
 * con un error de negocio (4xx, no recuperable reintentando). Si falla por red/5xx, se
 * conserva para un intento posterior y se detiene el barrido (preserva el orden).
 */
export async function flush(): Promise<{ processed: number; remaining: number }> {
  if (flushing) return { processed: 0, remaining: await pendingCount() };
  flushing = true;
  let processed = 0;
  try {
    let ops = await readAll();
    while (ops.length > 0) {
      const op = ops[0]!;
      const executor = executors.get(op.kind);
      if (!executor) {
        // Sin ejecutor registrado: descartar para no bloquear la cola indefinidamente.
        logger.warn("offline_no_executor", {}, { kind: op.kind });
        ops = ops.slice(1);
        await writeAll(ops);
        continue;
      }
      try {
        await executor(op);
        processed += 1;
        ops = ops.slice(1);
        await writeAll(ops);
      } catch (err) {
        const recoverable = !isApiError(err) || err.status === 0 || err.status >= 500;
        if (recoverable) {
          op.attempts += 1;
          await writeAll(ops);
          logger.warn("offline_retry_later", {}, { id: op.id, attempts: op.attempts });
          break; // detener; se reintentará al próximo flush
        }
        // Error de negocio: descartar (no se resolverá reintentando) y seguir.
        logger.error("offline_dropped", {}, { id: op.id });
        ops = ops.slice(1);
        await writeAll(ops);
      }
    }
    return { processed, remaining: ops.length };
  } finally {
    flushing = false;
  }
}
