import AsyncStorage from "@react-native-async-storage/async-storage";

import { logger } from "../logger";
import { newIdempotencyKey } from "../ids";
import { isApiError, type ErrorMessageKey } from "../errors";

/**
 * Cola de mutaciones para operar sin conexión (cobradores en ruta).
 *
 * Cada operación encolada guarda su `Idempotency-Key` ASÍ que al reintentarse (al recuperar
 * red) el backend la reconoce y no produce doble abono (§3.7 confiabilidad). La cola es
 * agnóstica del dominio: ejecuta operaciones por `kind` usando ejecutores registrados.
 *
 * Una operación que el servidor RECHAZA por error de negocio (4xx) no se descarta en silencio:
 * pasa a la lista `failed` (persistida, con motivo) para que la persona la vea, la reintente o
 * la descarte a conciencia. Un cobro "guardado" que no existe nunca debe desaparecer sin rastro.
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

/** Operación rechazada por el servidor: conserva todo lo encolado más el motivo y cuándo falló. */
export type FailedOperation = QueuedOperation & {
  failedAt: string;
  /** Clave i18n del motivo (`ApiError.messageKey`), traducible con `t(reason)`. */
  reason: ErrorMessageKey;
};

export type QueueState = { pending: QueuedOperation[]; failed: FailedOperation[] };

/** Ejecuta una operación encolada. Debe lanzar si falla (para que permanezca en cola). */
export type Executor = (op: QueuedOperation) => Promise<void>;

const executors = new Map<string, Executor>();

export function registerExecutor(kind: string, executor: Executor) {
  executors.set(kind, executor);
}

/** Resultado de un barrido: enviadas, rechazadas (pasaron a `failed`) y las que siguen en cola. */
export type FlushResult = { processed: number; dropped: number; remaining: number };

type PendingListener = (pending: number) => void;
type OperationsListener = (state: QueueState) => void;
const pendingListeners = new Set<PendingListener>();
const operationsListeners = new Set<OperationsListener>();

/** Avisa a la UI cada vez que cambia el número de operaciones pendientes (encolar o vaciar). */
export function subscribePending(listener: PendingListener): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

/** Avisa con el estado completo (pendientes + rechazadas) ante cualquier cambio de la cola. */
export function subscribeOperations(listener: OperationsListener): () => void {
  operationsListeners.add(listener);
  return () => {
    operationsListeners.delete(listener);
  };
}

function notify(state: QueueState) {
  for (const listener of pendingListeners) listener(state.pending.length);
  for (const listener of operationsListeners) listener(state);
}

/**
 * Lee el estado persistido. Migra el formato anterior (un array plano de pendientes) al actual
 * `{ pending, failed }` sin perder nada; un contenido ilegible se trata como cola vacía.
 */
async function readState(): Promise<QueueState> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return { pending: [], failed: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { pending: parsed as QueuedOperation[], failed: [] };
    const state = parsed as Partial<QueueState> | null;
    return {
      pending: Array.isArray(state?.pending) ? state.pending : [],
      failed: Array.isArray(state?.failed) ? state.failed : [],
    };
  } catch {
    return { pending: [], failed: [] };
  }
}

async function writeState(state: QueueState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const state = await readState();
  const next = { ...state, pending: [...state.pending, op] };
  await writeState(next);
  notify(next);
  logger.info("offline_enqueued", {}, { kind, id: op.id });
  return op;
}

export async function pendingCount(): Promise<number> {
  return (await readState()).pending.length;
}

/** Estado completo de la cola: lo pendiente de envío y lo rechazado por el servidor. */
export async function listOperations(): Promise<QueueState> {
  return readState();
}

/** Devuelve una operación rechazada a la cola de pendientes (misma clave: sin doble abono). */
export async function retryFailed(id: string): Promise<void> {
  const state = await readState();
  const failed = state.failed.find((op) => op.id === id);
  if (!failed) return;
  const op: QueuedOperation = {
    id: failed.id,
    kind: failed.kind,
    idempotencyKey: failed.idempotencyKey,
    payload: failed.payload,
    createdAt: failed.createdAt,
    attempts: 0,
  };
  const next: QueueState = {
    pending: [...state.pending, op],
    failed: state.failed.filter((f) => f.id !== id),
  };
  await writeState(next);
  notify(next);
  logger.info("offline_retry_failed", {}, { id });
}

/** Descarta a conciencia una operación rechazada (decisión explícita de la persona). */
export async function discardFailed(id: string): Promise<void> {
  const state = await readState();
  if (!state.failed.some((op) => op.id === id)) return;
  const next: QueueState = { ...state, failed: state.failed.filter((f) => f.id !== id) };
  await writeState(next);
  notify(next);
  logger.info("offline_discard_failed", {}, { id });
}

let flushing = false;

/** Clasifica un fallo del ejecutor: red/5xx se reintenta luego; el resto es rechazo de negocio. */
function isRecoverable(err: unknown): boolean {
  return !isApiError(err) || err.status === 0 || err.status >= 500;
}

function toFailed(op: QueuedOperation, reason: ErrorMessageKey): FailedOperation {
  return { ...op, failedAt: new Date().toISOString(), reason };
}

/**
 * Procesa la cola en orden. Una operación sale de pendientes si su ejecutor tiene éxito o si
 * falla con un error de negocio (4xx, no recuperable reintentando): en ese caso pasa a `failed`
 * con su motivo. Si falla por red/5xx, se conserva para un intento posterior y se detiene el
 * barrido (preserva el orden). `dropped` cuenta las que pasaron a `failed` en este barrido.
 */
export async function flush(): Promise<FlushResult> {
  if (flushing) return { processed: 0, dropped: 0, remaining: await pendingCount() };
  flushing = true;
  let processed = 0;
  let dropped = 0;
  let state: QueueState = { pending: [], failed: [] };
  try {
    state = await readState();
    while (state.pending.length > 0) {
      const op = state.pending[0]!;
      const rest = state.pending.slice(1);
      const executor = executors.get(op.kind);
      if (!executor) {
        // Sin ejecutor registrado: no bloquear la cola, pero dejarlo visible para la persona.
        logger.warn("offline_no_executor", {}, { kind: op.kind });
        dropped += 1;
        state = { pending: rest, failed: [...state.failed, toFailed(op, "errors.unknown")] };
        await writeState(state);
        continue;
      }
      try {
        await executor(op);
        processed += 1;
        state = { ...state, pending: rest };
        await writeState(state);
      } catch (err) {
        if (isRecoverable(err)) {
          const retried = { ...op, attempts: op.attempts + 1 };
          state = { ...state, pending: [retried, ...rest] };
          await writeState(state);
          logger.warn("offline_retry_later", {}, { id: op.id, attempts: retried.attempts });
          break; // detener; se reintentará al próximo flush
        }
        // Error de negocio: no se resolverá reintentando. Pasa a rechazadas con su motivo para que
        // la UI se lo diga a la persona: un cobro "guardado" que el servidor rechazó no existe.
        const reason: ErrorMessageKey = isApiError(err) ? err.messageKey : "errors.unknown";
        logger.error("offline_rejected", {}, { id: op.id, reason });
        dropped += 1;
        state = { pending: rest, failed: [...state.failed, toFailed(op, reason)] };
        await writeState(state);
      }
    }
    return { processed, dropped, remaining: state.pending.length };
  } finally {
    flushing = false;
    notify(await readState());
  }
}
