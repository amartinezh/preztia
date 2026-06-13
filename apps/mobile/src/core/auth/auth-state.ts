import type { SessionClaims } from "./jwt";

/**
 * Snapshot SÍNCRONO de la sesión para el transporte.
 *
 * El `ApiFetcher` necesita leer el token y el tenant de forma síncrona al construir cada
 * petición; no puede esperar a React. Esta caja mutable es la fuente que el fetcher lee y
 * que el `SessionProvider` mantiene actualizada. No se usa para render (eso es el contexto).
 */

type AuthSnapshot = {
  accessToken: string | null;
  claims: SessionClaims | null;
};

const snapshot: AuthSnapshot = { accessToken: null, claims: null };
let onUnauthorized: () => void = () => {};

export const authState = {
  getAccessToken: () => snapshot.accessToken,
  getTenantId: () => snapshot.claims?.tenantId ?? null,
  getClaims: () => snapshot.claims,
  set: (next: AuthSnapshot) => {
    snapshot.accessToken = next.accessToken;
    snapshot.claims = next.claims;
  },
  clear: () => {
    snapshot.accessToken = null;
    snapshot.claims = null;
  },
  /** Registra el manejador que cierra sesión cuando el backend responde 401. */
  registerUnauthorizedHandler: (handler: () => void) => {
    onUnauthorized = handler;
  },
  notifyUnauthorized: () => onUnauthorized(),
};
