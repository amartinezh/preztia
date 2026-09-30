import { ConflictError, ForbiddenError } from "../../shared/money";
import { addDays, businessDateOf, localHourInstant } from "../../shared/business-time";
import type { Role } from "../../iam/role";

// Regla pura de la FECHA DE UN PAGO registrado después de cobrarlo, sin I/O.
//
// Caso real: el cobrador cobra sin señal y el pago se registra cuando vuelve la conexión (o al día
// siguiente). La fecha del PAGO (reportes, recibo, cartera) puede quedar en el pasado; el LIBRO DE
// CAJAS no: el efectivo entra a la caja y a la rendición cuando se registra (ADR #41), así que los
// cortes y las fotos selladas nunca cambian.
//
// Dos formas, con reglas distintas:
// - CAPTURA OFFLINE (`capturedAt`): la hora real en que el dispositivo capturó el cobro, sin que
//   nadie la elija. Cualquier rol. Si cae fuera de la ventana (más días atrás que el límite, en un
//   período ya sellado o en el futuro por el reloj del teléfono), el pago NO se pierde: se registra
//   con la hora actual y el ajuste queda auditado (`adjusted`).
// - FECHA MANUAL (`paidOn`): alguien elige el día. Nunca el cobrador; el coordinador solo con el
//   bloqueo apagado; el ADMIN siempre. Fuera de la ventana se rechaza (409) diciendo por qué.
//
// MODO FLEXIBLE (`relaxed`): el tenant prioriza recibir el dinero sobre controlar la fecha. Se
// ignoran el límite de días y el período sellado, y el coordinador también puede elegir la fecha
// (el cobrador sigue usando la hora de captura). Solo queda una sensatez: nunca una fecha futura.
// Todo sigue auditado; el libro de cajas sigue fechándose al registrar.
//
// Invariantes (probadas): la fecha del pago nunca es futura; sin modo flexible, además, nunca es
// anterior al último período sellado ni más antigua que `maxDaysBack` días de negocio del tenant.

/** Límite superior de días hacia atrás configurables (un mes). */
export const MAX_BACKDATE_DAYS = 30;
/** Hora local con la que se fecha un día elegido a mano (mediodía: lejos de ambos cortes). */
const MANUAL_DATE_HOUR = 12;

/** Configuración del tenant (Ajustes → General). */
export interface BackdatePolicy {
  /** "Bloquear fechas atrasadas": solo el ADMIN elige una fecha pasada a mano. */
  readonly locked: boolean;
  /** Días de negocio hacia atrás permitidos (0 = solo hoy). */
  readonly maxDaysBack: number;
  /** Modo flexible: sin límite de días ni de período sellado; el coordinador también elige. */
  readonly relaxed: boolean;
}

/** Fecha pedida para el pago (ausente = ahora). */
export type RequestedPaymentDate =
  | { readonly kind: "OFFLINE_CAPTURE"; readonly capturedAt: Date }
  | { readonly kind: "MANUAL"; readonly paidOn: string };

/** Por qué una captura offline se registró con la hora actual en vez de la capturada. */
export type PaymentDateAdjustment = "FUTURE" | "TOO_OLD" | "SEALED";

export interface ResolvedPaymentDate {
  readonly paidAt: Date;
  /** La fecha del pago quedó antes del registro (se audita). */
  readonly backdated: boolean;
  /** Solo en capturas offline fuera de la ventana: se usó la hora actual. */
  readonly adjusted: PaymentDateAdjustment | null;
}

export interface PaymentDateContext {
  readonly policy: BackdatePolicy;
  readonly actorRole: Role;
  readonly now: Date;
  readonly timeZone: string;
  /** Fin del último período de liquidación sellado; null si no hay ninguno. */
  readonly sealedUntil: Date | null;
}

/** ¿Este rol puede elegir a mano la fecha de un pago? */
export function canChoosePaymentDate(policy: BackdatePolicy, actorRole: Role): boolean {
  if (actorRole === "ADMIN") return true;
  return actorRole === "COORDINATOR" && (policy.relaxed || !policy.locked);
}

/** Resuelve la fecha del pago según la forma pedida y las reglas del tenant. */
export function resolvePaymentDate(requested: RequestedPaymentDate | null, ctx: PaymentDateContext): ResolvedPaymentDate {
  if (requested === null) return { paidAt: ctx.now, backdated: false, adjusted: null };
  return requested.kind === "OFFLINE_CAPTURE"
    ? resolveOfflineCapture(requested.capturedAt, ctx)
    : resolveManualDate(requested.paidOn, ctx);
}

function resolveOfflineCapture(capturedAt: Date, ctx: PaymentDateContext): ResolvedPaymentDate {
  const adjusted = violationOf(capturedAt, ctx);
  if (adjusted) return { paidAt: ctx.now, backdated: false, adjusted };
  return { paidAt: capturedAt, backdated: capturedAt < ctx.now, adjusted: null };
}

function resolveManualDate(paidOn: string, ctx: PaymentDateContext): ResolvedPaymentDate {
  if (!canChoosePaymentDate(ctx.policy, ctx.actorRole)) {
    throw new ForbiddenError(
      ctx.policy.locked
        ? "Las fechas atrasadas están bloqueadas: solo el administrador puede elegir la fecha del pago"
        : "Tu rol no puede elegir la fecha del pago",
      "BACKDATE_LOCKED",
    );
  }
  const today = businessDateOf(ctx.now, ctx.timeZone);
  // Hoy es "ahora"; un día pasado se fecha a mediodía local de ese día.
  const paidAt = paidOn === today ? ctx.now : localHourInstant(paidOn, MANUAL_DATE_HOUR, ctx.timeZone);
  switch (violationOf(paidAt, ctx)) {
    case "FUTURE":
      throw new ConflictError("La fecha del pago no puede ser futura", "PAYMENT_DATE_IN_FUTURE");
    case "TOO_OLD":
      throw new ConflictError(
        `La fecha del pago no puede ser de hace más de ${ctx.policy.maxDaysBack} día(s)`,
        "PAYMENT_DATE_TOO_OLD",
      );
    case "SEALED":
      throw new ConflictError(
        "La fecha del pago cae en un período de liquidación ya cerrado",
        "PAYMENT_DATE_SEALED",
      );
    case null:
      return { paidAt, backdated: paidAt < ctx.now, adjusted: null };
  }
}

/** Qué regla viola una fecha de pago (null = ninguna). */
function violationOf(paidAt: Date, ctx: PaymentDateContext): PaymentDateAdjustment | null {
  if (paidAt > ctx.now) return "FUTURE";
  if (ctx.policy.relaxed) return null;
  const oldestAllowed = addDays(businessDateOf(ctx.now, ctx.timeZone), -Math.max(0, ctx.policy.maxDaysBack));
  if (businessDateOf(paidAt, ctx.timeZone) < oldestAllowed) return "TOO_OLD";
  if (ctx.sealedUntil && paidAt < ctx.sealedUntil) return "SEALED";
  return null;
}
