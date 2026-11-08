import { describe, expect, it, vi } from "vitest";

import { ApiError, networkError } from "../errors";
import type { SessionClaims } from "./jwt";
import type { StoredTokens } from "./token-storage";
import {
  createRefreshSession,
  msUntilRefresh,
  needsRefresh,
  REFRESH_LEEWAY_MS,
} from "./refresh-policy";

const NOW_MS = 1_700_000_000_000;
const expAt = (secondsFromNow: number) => ({ exp: Math.floor(NOW_MS / 1000) + secondsFromNow });

describe("needsRefresh / msUntilRefresh", () => {
  it("no renueva mientras falte más que el margen de seguridad", () => {
    const claims = expAt(10 * 60);
    expect(needsRefresh(claims, NOW_MS)).toBe(false);
    expect(msUntilRefresh(claims, NOW_MS)).toBe(10 * 60_000 - REFRESH_LEEWAY_MS);
  });

  it("renueva dentro del margen y cuando ya venció", () => {
    expect(needsRefresh(expAt(90), NOW_MS)).toBe(true);
    expect(msUntilRefresh(expAt(90), NOW_MS)).toBe(0);
    expect(needsRefresh(expAt(-5), NOW_MS)).toBe(true);
    expect(msUntilRefresh(expAt(-5), NOW_MS)).toBe(0);
  });
});

const claims: SessionClaims = { userId: "u", tenantId: "t", role: "ADMIN", zonePaths: [], exp: 1 };
const pair: StoredTokens = { accessToken: "access-2", refreshToken: "refresh-2" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createRefreshSession", () => {
  it("dos llamadas concurrentes comparten UNA sola renovación", async () => {
    const gate = deferred<StoredTokens>();
    const requestTokens = vi.fn(() => gate.promise);
    const applyTokens = vi.fn(async () => claims);
    const refresh = createRefreshSession({ getRefreshToken: () => "refresh-1", requestTokens, applyTokens });

    const first = refresh();
    const second = refresh();
    expect(second).toBe(first);
    gate.resolve(pair);
    await expect(Promise.all([first, second])).resolves.toEqual(["refreshed", "refreshed"]);
    expect(requestTokens).toHaveBeenCalledTimes(1);
    expect(applyTokens).toHaveBeenCalledWith(pair);

    // Terminada la renovación, la siguiente llamada vuelve a ir al servidor.
    await refresh();
    expect(requestTokens).toHaveBeenCalledTimes(2);
  });

  it("sin refresh token la sesión terminó (rejected) sin ir al servidor", async () => {
    const requestTokens = vi.fn(async () => pair);
    const refresh = createRefreshSession({
      getRefreshToken: () => null,
      requestTokens,
      applyTokens: async () => claims,
    });
    await expect(refresh()).resolves.toBe("rejected");
    expect(requestTokens).not.toHaveBeenCalled();
  });

  it("401/403 del servidor → rejected; red caída → unavailable (se conserva la sesión)", async () => {
    const make = (err: unknown) =>
      createRefreshSession({
        getRefreshToken: () => "refresh-1",
        requestTokens: async () => {
          throw err;
        },
        applyTokens: async () => claims,
      });
    await expect(make(new ApiError({ status: 401, messageKey: "errors.unauthorized" }))()).resolves.toBe("rejected");
    await expect(make(new ApiError({ status: 403, messageKey: "errors.forbidden" }))()).resolves.toBe("rejected");
    await expect(make(networkError(false))()).resolves.toBe("unavailable");
    await expect(make(new ApiError({ status: 503, messageKey: "errors.server" }))()).resolves.toBe("unavailable");
  });

  it("un access token recibido inválido cuenta como rechazo", async () => {
    const refresh = createRefreshSession({
      getRefreshToken: () => "refresh-1",
      requestTokens: async () => pair,
      applyTokens: async () => null,
    });
    await expect(refresh()).resolves.toBe("rejected");
  });
});
