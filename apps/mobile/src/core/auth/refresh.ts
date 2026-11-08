import { api, unwrap } from "../api/client";
import { logger } from "../logger";
import { authState } from "./auth-state";
import { decodeSessionClaims, isExpired, type SessionClaims } from "./jwt";
import { createRefreshSession, type RefreshOutcome } from "./refresh-policy";
import { tokenStorage, type StoredTokens } from "./token-storage";

export { needsRefresh, msUntilRefresh, REFRESH_RETRY_MS, type RefreshOutcome } from "./refresh-policy";

/**
 * Cableado de la renovación de sesión (sin UI): une la política pura con el cliente HTTP, el
 * snapshot del transporte y el almacenamiento seguro. La usan el fetcher (ante un 401) y el
 * `SessionProvider` (temporizador proactivo y rehidratación).
 */

/**
 * Aplica un par de tokens válido al snapshot del transporte y al almacenamiento seguro.
 * Devuelve los claims o `null` si el access token es inválido o ya venció (no se aplica nada).
 * Si el servidor no devuelve refresh token, se conserva el vigente para no acortar la sesión.
 */
export async function applySessionTokens(tokens: StoredTokens): Promise<SessionClaims | null> {
  const claims = decodeSessionClaims(tokens.accessToken);
  if (!claims || isExpired(claims)) return null;
  const refreshToken = tokens.refreshToken ?? authState.getRefreshToken();
  authState.set({ accessToken: tokens.accessToken, refreshToken, claims });
  await tokenStorage.save({ accessToken: tokens.accessToken, refreshToken });
  return claims;
}

/**
 * Renueva la sesión con el refresh token guardado (una sola renovación en vuelo a la vez).
 * Nunca cierra sesión por sí misma: devuelve el desenlace y quien llama decide (el provider
 * cierra con motivo "expired" ante `rejected`).
 */
export const refreshSession: () => Promise<RefreshOutcome> = createRefreshSession({
  getRefreshToken: authState.getRefreshToken,
  requestTokens: async (refreshToken) => {
    const tokens = unwrap(await api.refresh({ body: { refreshToken } }));
    logger.info("session_refreshed", { tenantId: authState.getTenantId() ?? undefined });
    return tokens;
  },
  applyTokens: applySessionTokens,
});
