import { isApiError } from "../errors";
import type { SessionClaims } from "./jwt";
import type { StoredTokens } from "./token-storage";

/**
 * Política de RENOVACIÓN de sesión (lógica pura, sin red ni React).
 *
 * El access token dura poco (15 min en el backend). Para que la persona no sea expulsada a
 * mitad de un formulario, la sesión se renueva ANTES de vencer (proactivo) y, si aun así una
 * petición recibe 401, el transporte renueva una vez y reintenta (reactivo). Ambos caminos
 * comparten la misma función con exclusión mutua: N peticiones concurrentes que reciben 401
 * disparan UNA sola renovación.
 */

/** Se renueva cuando faltan menos de 2 minutos para que venza el access token. */
export const REFRESH_LEEWAY_MS = 2 * 60_000;
/** Si la renovación no pudo decidirse (sin red), se vuelve a intentar al rato. */
export const REFRESH_RETRY_MS = 30_000;

/**
 * Desenlace de un intento de renovación:
 * - `refreshed`: hay tokens nuevos aplicados.
 * - `rejected`: el servidor no acepta el refresh token (vencido, revocado, usuario inactivo) o no
 *   hay refresh token: la sesión terminó y hay que cerrar con motivo "expired".
 * - `unavailable`: no se pudo decidir (sin red, 5xx): la sesión se conserva y se reintenta luego.
 */
export type RefreshOutcome = "refreshed" | "rejected" | "unavailable";

type ExpiringClaims = Pick<SessionClaims, "exp">;

/** ¿Toca renovar ya? (vencido o dentro del margen de seguridad). */
export function needsRefresh(claims: ExpiringClaims, nowMs = Date.now()): boolean {
  return claims.exp * 1000 - nowMs <= REFRESH_LEEWAY_MS;
}

/** Milisegundos hasta el momento de renovar (0 si ya toca). */
export function msUntilRefresh(claims: ExpiringClaims, nowMs = Date.now()): number {
  return Math.max(0, claims.exp * 1000 - REFRESH_LEEWAY_MS - nowMs);
}

export type RefreshDeps = {
  getRefreshToken: () => string | null;
  /** Pide el par de tokens nuevo al backend; lanza `ApiError` si falla. */
  requestTokens: (refreshToken: string) => Promise<StoredTokens>;
  /** Aplica los tokens (snapshot + almacenamiento); `null` si el access token recibido no sirve. */
  applyTokens: (tokens: StoredTokens) => Promise<SessionClaims | null>;
};

const SESSION_ENDED_STATUSES = new Set([401, 403]);

/**
 * Construye `refreshSession()` con exclusión mutua: mientras una renovación está en curso, toda
 * llamada concurrente recibe la MISMA promesa (un solo viaje al servidor, un solo par de tokens).
 */
export function createRefreshSession(deps: RefreshDeps): () => Promise<RefreshOutcome> {
  let inFlight: Promise<RefreshOutcome> | null = null;

  const run = async (): Promise<RefreshOutcome> => {
    const refreshToken = deps.getRefreshToken();
    if (!refreshToken) return "rejected";
    let tokens: StoredTokens;
    try {
      tokens = await deps.requestTokens(refreshToken);
    } catch (err) {
      if (isApiError(err) && SESSION_ENDED_STATUSES.has(err.status)) return "rejected";
      return "unavailable";
    }
    const claims = await deps.applyTokens(tokens);
    return claims ? "refreshed" : "rejected";
  };

  return () => {
    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
