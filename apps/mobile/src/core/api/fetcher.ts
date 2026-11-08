import { tsRestFetchApi, type ApiFetcher, type ApiFetcherArgs } from "@ts-rest/core";

import { env } from "../env";
import { logger } from "../logger";
import { newCorrelationId } from "../ids";
import { networkError } from "../errors";
import type { RefreshOutcome } from "../auth/refresh-policy";
import { takeRequestOptions } from "./request-context";

/**
 * Fetcher de transporte: el ÚNICO punto donde se inyectan los aspectos transversales.
 * No conoce reglas de negocio (SRP). Responsabilidades:
 *  - `X-Correlation-Id` por petición (auditabilidad / observabilidad).
 *  - `Authorization: Bearer` desde la sesión (seguridad; el tenant lo impone el JWT en el backend).
 *  - `Idempotency-Key` en mutaciones de dinero (confiabilidad; sin doble abono).
 *  - Timeout por petición y reintentos con backoff SOLO en métodos seguros (resiliencia).
 *  - Ante un 401: renovar la sesión UNA vez y reintentar con el token nuevo; si la renovación
 *    es rechazada, señal hacia la sesión (cierra sesión con motivo "expired").
 */

export type FetcherDeps = {
  getAccessToken: () => string | null;
  getTenantId: () => string | null;
  onUnauthorized: () => void;
  /** Renueva la sesión (con exclusión mutua: N 401 concurrentes → una sola renovación). */
  refreshSession: () => Promise<RefreshOutcome>;
};

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 300;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
// Un 401 en estas rutas es una credencial rechazada, no una sesión vencida: ni se renueva (sería
// recursivo en /auth/refresh) ni se cierra sesión desde aquí (lo decide quien llamó).
const AUTH_ROUTES = new Set(["/auth/login", "/auth/refresh"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createFetcher(deps: FetcherDeps): ApiFetcher {
  return async (args: ApiFetcherArgs) => {
    // Consumir el contexto de petición de forma SÍNCRONA, antes de cualquier await.
    const { idempotencyKey } = takeRequestOptions();
    const correlationId = newCorrelationId();
    const method = args.method.toUpperCase();
    const isSafe = SAFE_METHODS.has(method);
    const isAuthRoute = AUTH_ROUTES.has(args.route.path);
    const tenantId = deps.getTenantId();

    const headers: Record<string, string> = {
      ...args.headers,
      "x-correlation-id": correlationId,
    };
    const token = deps.getAccessToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (idempotencyKey && !isSafe) headers["idempotency-key"] = idempotencyKey;

    let attempt = 0;
    let refreshed = false;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs);
      try {
        const res = await tsRestFetchApi({
          ...args,
          headers,
          fetchOptions: { ...args.fetchOptions, signal: controller.signal },
        });
        clearTimeout(timer);

        if (res.status === 401 && !isAuthRoute) {
          // Una sola renovación por petición; la misma Idempotency-Key viaja en el reintento.
          if (!refreshed) {
            refreshed = true;
            const outcome = await deps.refreshSession();
            if (outcome === "refreshed") {
              const fresh = deps.getAccessToken();
              if (fresh) headers["authorization"] = `Bearer ${fresh}`;
              continue;
            }
            if (outcome === "rejected") deps.onUnauthorized();
            // `unavailable` (sin red): se conserva la sesión y el 401 llega a quien llamó.
          } else {
            deps.onUnauthorized();
          }
        }

        // Reintento con backoff exponencial solo para peticiones seguras ante 5xx.
        if (isSafe && res.status >= 500 && attempt < MAX_RETRIES) {
          attempt += 1;
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }

        logger[res.status >= 400 ? "warn" : "info"](
          "http_response",
          { tenantId, correlationId },
          { method, path: args.path, status: res.status },
        );
        return res;
      } catch (err) {
        clearTimeout(timer);
        const aborted = err instanceof Error && err.name === "AbortError";
        if (isSafe && attempt < MAX_RETRIES) {
          attempt += 1;
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        logger.error("http_error", { tenantId, correlationId }, { method, path: args.path, aborted });
        throw networkError(aborted, correlationId);
      }
    }
  };
}
