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
  | "errors.plans.noDefault"
  | "errors.cash.staleCount"
  | "errors.cash.countAdjusted"
  | "errors.cash.noDiscrepancy"
  | "errors.cash.noRouteBox"
  | "errors.cash.boxNotUsableByZone"
  | "errors.cash.routeBoxCannotFund"
  | "errors.remittance.alreadySubmitted"
  | "errors.remittance.nothingToRemit"
  | "errors.remittance.countExceedsExpected"
  | "errors.remittance.notOpen"
  | "errors.remittance.invalidDestination"
  | "errors.remittance.inProgress"
  | "errors.remittance.debtExceeded"
  | "errors.telegram.invalidToken"
  | "errors.telegram.disabled"
  | "errors.telegram.botMismatch"
  | "errors.telegram.publicUrlMissing"
  | "errors.channels.required"
  | "errors.channels.preferredDisabled"
  | "errors.channels.unreachable";

// Códigos de dominio del backend con mensaje accionable propio: más específico que el
// genérico por status (ej. un 409 por falta de planes dice DÓNDE configurarlos).
const DOMAIN_CODE_KEYS: Record<string, ErrorMessageKey> = {
  NO_ACTIVE_PLANS: "errors.plans.noActive",
  NO_DEFAULT_PLAN: "errors.plans.noDefault",
  STALE_COUNT: "errors.cash.staleCount",
  COUNT_ALREADY_ADJUSTED: "errors.cash.countAdjusted",
  NO_DISCREPANCY: "errors.cash.noDiscrepancy",
  NO_ROUTE_CASH_BOX: "errors.cash.noRouteBox",
  BOX_NOT_USABLE_BY_ZONE: "errors.cash.boxNotUsableByZone",
  ROUTE_BOX_CANNOT_FUND: "errors.cash.routeBoxCannotFund",
  // Rendición del cobrador (Fase 2)
  REMITTANCE_ALREADY_SUBMITTED: "errors.remittance.alreadySubmitted",
  NOTHING_TO_REMIT: "errors.remittance.nothingToRemit",
  COUNT_EXCEEDS_EXPECTED: "errors.remittance.countExceedsExpected",
  REMITTANCE_NOT_OPEN: "errors.remittance.notOpen",
  INVALID_REMITTANCE_DESTINATION: "errors.remittance.invalidDestination",
  REMITTANCE_IN_PROGRESS: "errors.remittance.inProgress",
  DEBT_EXCEEDED: "errors.remittance.debtExceeded",
  // Canales de mensajería (ADR #40)
  TELEGRAM_INVALID_TOKEN: "errors.telegram.invalidToken",
  TELEGRAM_DISABLED: "errors.telegram.disabled",
  TELEGRAM_BOT_MISMATCH: "errors.telegram.botMismatch",
  PUBLIC_API_URL_MISSING: "errors.telegram.publicUrlMissing",
  MESSAGING_CHANNEL_REQUIRED: "errors.channels.required",
  PREFERRED_CHANNEL_DISABLED: "errors.channels.preferredDisabled",
  NO_REACHABLE_CHANNEL: "errors.channels.unreachable",
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
