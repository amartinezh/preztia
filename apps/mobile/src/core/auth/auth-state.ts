import type { SessionClaims } from "./jwt";
import type { RefreshOutcome } from "./refresh-policy";

/**
 * Snapshot SÍNCRONO de la sesión para el transporte.
 *
 * El `ApiFetcher` necesita leer el token y el tenant de forma síncrona al construir cada
 * petición; no puede esperar a React. Esta caja mutable es la fuente que el fetcher lee y
 * que el `SessionProvider` mantiene actualizada. No se usa para render (eso es el contexto):
 * el provider se SUSCRIBE a los cambios para reflejar en React los claims renovados.
 */

type AuthSnapshot = {
  accessToken: string | null;
  /** Token de renovación: lo usa `refreshSession()` cuando el access token vence. */
  refreshToken: string | null;
  claims: SessionClaims | null;
};

type SnapshotListener = (claims: SessionClaims | null) => void;

const snapshot: AuthSnapshot = { accessToken: null, refreshToken: null, claims: null };
const listeners = new Set<SnapshotListener>();
let onUnauthorized: () => void = () => {};
// Sin manejador registrado, un 401 se comporta como antes de la renovación: la sesión terminó.
let onRefresh: () => Promise<RefreshOutcome> = async () => "rejected";

function notify() {
  for (const listener of listeners) listener(snapshot.claims);
}

export const authState = {
  getAccessToken: () => snapshot.accessToken,
  getRefreshToken: () => snapshot.refreshToken,
  getTenantId: () => snapshot.claims?.tenantId ?? null,
  getClaims: () => snapshot.claims,
  set: (next: AuthSnapshot) => {
    snapshot.accessToken = next.accessToken;
    snapshot.refreshToken = next.refreshToken;
    snapshot.claims = next.claims;
    notify();
  },
  clear: () => {
    snapshot.accessToken = null;
    snapshot.refreshToken = null;
    snapshot.claims = null;
    notify();
  },
  /** Avisa cada vez que cambian los claims (login, renovación, cierre). Devuelve el desuscriptor. */
  subscribe: (listener: SnapshotListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Registra el manejador que cierra sesión cuando el backend responde 401. */
  registerUnauthorizedHandler: (handler: () => void) => {
    onUnauthorized = handler;
  },
  notifyUnauthorized: () => onUnauthorized(),
  /** Registra la renovación de sesión que el transporte invoca ante un 401 (ver `refreshSession`). */
  registerRefreshHandler: (handler: () => Promise<RefreshOutcome>) => {
    onRefresh = handler;
  },
  requestRefresh: (): Promise<RefreshOutcome> => onRefresh(),
};
