import { describe, expect, it } from "vitest";
import { decodeSessionClaims, isExpired } from "./jwt";

// Construye un JWT de prueba (firma irrelevante: el cliente no la verifica).
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

const future = Math.floor(Date.now() / 1000) + 3600;

describe("decodeSessionClaims", () => {
  it("deriva tenant/rol/zonas de los claims del token", () => {
    const token = makeToken({
      sub: "u-1",
      tenantId: "t-1",
      role: "COORDINATOR",
      zonePaths: ["co.bogota.suba"],
      exp: future,
    });
    const claims = decodeSessionClaims(token);
    expect(claims).toEqual({
      userId: "u-1",
      tenantId: "t-1",
      role: "COORDINATOR",
      zonePaths: ["co.bogota.suba"],
      exp: future,
    });
  });

  it("rechaza tokens con forma inválida o rol desconocido", () => {
    expect(decodeSessionClaims("no-es-un-jwt")).toBeNull();
    expect(decodeSessionClaims(makeToken({ sub: "u", tenantId: "t", role: "HACKER", exp: future }))).toBeNull();
    expect(decodeSessionClaims(makeToken({ sub: "u", role: "ADMIN", exp: future }))).toBeNull();
  });

  it("detecta expiración", () => {
    const claims = decodeSessionClaims(
      makeToken({ sub: "u", tenantId: "t", role: "ADMIN", exp: 1 }),
    )!;
    expect(isExpired(claims)).toBe(true);
  });
});
