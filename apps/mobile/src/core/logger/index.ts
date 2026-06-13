/**
 * Logger estructurado del cliente (observabilidad, §3.7).
 *
 * Emite objetos JSON con `tenantId` + `correlationId`. NUNCA registra PII: las claves
 * sensibles se enmascaran antes de salir. Punto único de integración futura con un
 * recolector remoto (Sentry/OTel) sin tocar las llamadas existentes.
 */

type Level = "debug" | "info" | "warn" | "error";

export type LogContext = {
  tenantId?: string | null;
  correlationId?: string;
};

// Claves que jamás deben aparecer en logs (datos personales del deudor/pagador).
const PII_KEYS = new Set([
  "name",
  "payername",
  "fullname",
  "taxid",
  "payertaxid",
  "cpf",
  "cnpj",
  "document",
  "email",
  "phone",
  "address",
  "token",
  "authorization",
  "password",
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, context: LogContext, data?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    tenantId: context.tenantId ?? null,
    correlationId: context.correlationId ?? null,
    ...(data === undefined ? {} : { data: redact(data) }),
  };
  // Una sola salida estructurada; el transporte real (consola/remoto) se decide aquí.
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx: LogContext = {}, data?: unknown) => emit("debug", msg, ctx, data),
  info: (msg: string, ctx: LogContext = {}, data?: unknown) => emit("info", msg, ctx, data),
  warn: (msg: string, ctx: LogContext = {}, data?: unknown) => emit("warn", msg, ctx, data),
  error: (msg: string, ctx: LogContext = {}, data?: unknown) => emit("error", msg, ctx, data),
  /** Expuesto para pruebas del enmascarado de PII. */
  _redact: redact,
};
