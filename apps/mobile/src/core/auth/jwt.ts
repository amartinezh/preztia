/**
 * Decodificación de JWT en el cliente (sin verificar firma: eso es del backend).
 *
 * La identidad de tenant/rol se DERIVA de los claims del access token, nunca de input
 * del usuario ni de un header manipulable (§3.7 seguridad, §21). El cliente solo lee los
 * claims para decidir qué mostrar; la autoridad real la impone la API + RLS.
 */

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "COORDINATOR" | "COLLECTOR";

export type SessionClaims = {
  /** Identificador del usuario (subject). */
  userId: string;
  tenantId: string;
  role: UserRole;
  /** Subárbol(es) de zonas asignadas (paths ltree) para authZ de alcance. */
  zonePaths: string[];
  /** Expiración (epoch segundos). */
  exp: number;
};

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    "=",
  );
  if (typeof globalThis.atob === "function") return decodeURIComponent(escape(globalThis.atob(padded)));
  // Fallback nativo (Hermes): Buffer puede no existir; usamos un decodificador mínimo.
  const BufferRef = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
    .Buffer;
  if (BufferRef) return BufferRef.from(padded, "base64").toString("utf-8");
  throw new Error("No base64 decoder available");
}

const VALID_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "COORDINATOR",
  "COLLECTOR",
]);

/** Decodifica y valida la forma de los claims. Devuelve `null` si el token es inválido. */
export function decodeSessionClaims(accessToken: string): SessionClaims | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
    const userId = payload.sub;
    const tenantId = payload.tenantId ?? payload.tid;
    const role = payload.role;
    const exp = payload.exp;
    if (
      typeof userId !== "string" ||
      typeof tenantId !== "string" ||
      typeof role !== "string" ||
      !VALID_ROLES.has(role) ||
      typeof exp !== "number"
    ) {
      return null;
    }
    const zonePaths = Array.isArray(payload.zonePaths)
      ? payload.zonePaths.filter((z): z is string => typeof z === "string")
      : [];
    return { userId, tenantId, role: role as UserRole, zonePaths, exp };
  } catch {
    return null;
  }
}

export function isExpired(claims: SessionClaims, nowMs = Date.now()): boolean {
  return claims.exp * 1000 <= nowMs;
}
