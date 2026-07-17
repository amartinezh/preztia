/**
 * Normalización de errores en la frontera del cliente.
 *
 * El backend traduce `DomainError` a códigos HTTP (400/404/409) vía Exception Filters.
 * Aquí convertimos esa respuesta en un `ApiError` con un `messageKey` estable (para i18n)
 * y el `correlationId` del fallo (para soporte/auditoría). La UI nunca interpreta `status`
 * crudo: consume `ApiError`.
 */

export type ErrorMessageKey =
  | "errors.network"
  | "errors.timeout"
  | "errors.unauthorized"
  | "errors.forbidden"
  | "errors.notFound"
  | "errors.conflict"
  | "errors.validation"
  | "errors.server"
  | "errors.unknown"
  | "errors.plans.noActive"
  | "errors.plans.noDefault";

// Códigos de dominio del backend con mensaje accionable propio: más específico que el
// genérico por status (ej. un 409 por falta de planes dice DÓNDE configurarlos).
const DOMAIN_CODE_KEYS: Record<string, ErrorMessageKey> = {
  NO_ACTIVE_PLANS: "errors.plans.noActive",
  NO_DEFAULT_PLAN: "errors.plans.noDefault",
};

export class ApiError extends Error {
  readonly status: number;
  readonly messageKey: ErrorMessageKey;
  /** Código de dominio del backend (ej. `INSUFFICIENT_BALANCE`), si vino en el cuerpo. */
  readonly domainCode: string | undefined;
  readonly correlationId: string | undefined;

  constructor(args: {
    status: number;
    messageKey: ErrorMessageKey;
    domainCode?: string | undefined;
    correlationId?: string | undefined;
    message?: string;
  }) {
    super(args.message ?? args.messageKey);
    this.name = "ApiError";
    this.status = args.status;
    this.messageKey = args.messageKey;
    this.domainCode = args.domainCode;
    this.correlationId = args.correlationId;
  }
}

function keyForStatus(status: number): ErrorMessageKey {
  if (status === 0) return "errors.network";
  if (status === 401) return "errors.unauthorized";
  if (status === 403) return "errors.forbidden";
  if (status === 404) return "errors.notFound";
  if (status === 409) return "errors.conflict";
  if (status === 400 || status === 422) return "errors.validation";
  if (status >= 500) return "errors.server";
  return "errors.unknown";
}

type ErrorBody = { code?: unknown; message?: unknown } | null | undefined;

/** Construye un `ApiError` a partir de la respuesta cruda del transporte. */
export function normalizeHttpError(
  status: number,
  body: ErrorBody,
  correlationId?: string,
): ApiError {
  const domainCode = typeof body?.code === "string" ? body.code : undefined;
  const serverMessage = typeof body?.message === "string" ? body.message : undefined;
  const domainKey = domainCode ? DOMAIN_CODE_KEYS[domainCode] : undefined;
  return new ApiError({
    status,
    messageKey: domainKey ?? keyForStatus(status),
    domainCode,
    correlationId,
    message: serverMessage,
  });
}

/** Error de transporte (red caída, timeout, abort). */
export function networkError(timedOut: boolean, correlationId?: string): ApiError {
  return new ApiError({
    status: 0,
    messageKey: timedOut ? "errors.timeout" : "errors.network",
    correlationId,
  });
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
