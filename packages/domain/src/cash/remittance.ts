// Dominio puro de la RENDICIÓN DE CUENTAS del cobrador (caja de ruta), sin I/O.
//
// La caja de ruta es la cuenta del cobrador: su saldo es el efectivo en su poder. Una rendición es
// un CORTE: resume los movimientos desde el corte anterior ("recogí X, gasté Y, entrego Z"), el
// cobrador declara lo que entrega y el coordinador cuenta. Lo que no se entrega queda en la caja
// como DEUDA y se arrastra al siguiente corte (no hay un segundo número que pueda divergir).
//
// Invariantes:
// - esperado = saldo anterior + Σ entradas − Σ salidas (= saldo del libro al momento).
// - esperado = contado + faltante; nunca se recibe más de lo esperado.
// - la deuda solo se cierra por el monto arrastrado, con motivo, y sin rendición en curso.

import { ConflictError, DomainError } from "../shared/money";
import { addDays, businessDateOf, localHourInstant } from "../shared/business-time";
import { type CashTxDirection, type CashTxKind, type PostingIntent } from "./cash-box";

const MS_PER_MINUTE = 60_000;

/** Movimiento de la caja de ruta reducido a lo que importa para la rendición. */
export interface RouteBoxMovement {
  readonly direction: CashTxDirection;
  readonly kind: CashTxKind;
  readonly amountMinor: number;
}

export interface RemittanceSummary {
  /** Saldo al corte anterior (efectivo/deuda que ya traía). */
  readonly openingMinor: number;
  /** Cobros en efectivo del período ("recogí"). */
  readonly collectedMinor: number;
  /** Gastos pagados desde su caja ("gasté"). */
  readonly expensesMinor: number;
  /** Salidas por transferencia: consignaciones y entregas parciales. */
  readonly transferredOutMinor: number;
  /** Deuda cerrada por el ADMIN (nómina o condonación). */
  readonly debtClosedMinor: number;
  readonly otherInMinor: number;
  readonly otherOutMinor: number;
  /** Lo que debe entregar ("entrego"): saldo esperado según el libro. */
  readonly expectedMinor: number;
}

/** Resume los movimientos desde el corte anterior. */
export function summarizeRemittance(
  openingMinor: number,
  movements: readonly RouteBoxMovement[],
): RemittanceSummary {
  const total = (predicate: (m: RouteBoxMovement) => boolean): number =>
    movements.filter(predicate).reduce((acc, m) => acc + m.amountMinor, 0);
  const isIn = (m: RouteBoxMovement) => m.direction === "IN";
  const isOut = (m: RouteBoxMovement) => m.direction === "OUT";

  const collectedMinor = total((m) => isIn(m) && m.kind === "PAYMENT_IN");
  const expensesMinor = total((m) => isOut(m) && m.kind === "EXPENSE");
  const transferredOutMinor = total((m) => isOut(m) && m.kind === "TRANSFER");
  const debtClosedMinor = total((m) => isOut(m) && m.kind === "DEBT_CLOSURE");
  const otherInMinor = total(isIn) - collectedMinor;
  const otherOutMinor = total(isOut) - expensesMinor - transferredOutMinor - debtClosedMinor;
  return {
    openingMinor,
    collectedMinor,
    expensesMinor,
    transferredOutMinor,
    debtClosedMinor,
    otherInMinor,
    otherOutMinor,
    expectedMinor: openingMinor + total(isIn) - total(isOut),
  };
}

export type RemittanceStatus = "UP_TO_DATE" | "PENDING" | "LATE" | "AWAITING_RECEPTION";

export interface RemittanceObligation {
  readonly status: RemittanceStatus;
  /** Instante límite para declarar; null si no hay obligación o ya declaró. */
  readonly dueAt: Date | null;
  readonly lateMinutes: number;
}

/**
 * ¿Debe rendir y cuánto atraso lleva? Hay obligación solo si cobró efectivo después del último
 * corte (el día sin cobros queda exento). Vence a la hora límite local del día de negocio del
 * cobro más antiguo sin rendir; un cobro hecho después de esa hora vence al día siguiente.
 */
export function remittanceObligation(input: {
  hasOpenSubmission: boolean;
  oldestUnremittedCollectionAt: Date | null;
  now: Date;
  deadlineHourLocal: number;
  timeZone: string;
}): RemittanceObligation {
  if (input.hasOpenSubmission) return { status: "AWAITING_RECEPTION", dueAt: null, lateMinutes: 0 };
  const collectedAt = input.oldestUnremittedCollectionAt;
  if (!collectedAt) return { status: "UP_TO_DATE", dueAt: null, lateMinutes: 0 };

  const businessDate = businessDateOf(collectedAt, input.timeZone);
  let dueAt = localHourInstant(businessDate, input.deadlineHourLocal, input.timeZone);
  if (dueAt.getTime() <= collectedAt.getTime()) {
    dueAt = localHourInstant(addDays(businessDate, 1), input.deadlineHourLocal, input.timeZone);
  }
  const overdueMs = input.now.getTime() - dueAt.getTime();
  return overdueMs > 0
    ? { status: "LATE", dueAt, lateMinutes: Math.floor(overdueMs / MS_PER_MINUTE) }
    : { status: "PENDING", dueAt, lateMinutes: 0 };
}

/** Guarda de la declaración del cobrador. */
export function assertCanSubmitRemittance(input: {
  hasOpenSubmission: boolean;
  hasUnremittedCollections: boolean;
  balanceMinor: number;
  declaredMinor: number;
}): void {
  assertNonNegativeInteger(input.declaredMinor, "El monto declarado");
  if (input.hasOpenSubmission) {
    throw new ConflictError(
      "Ya tienes una rendición declarada esperando recepción",
      "REMITTANCE_ALREADY_SUBMITTED",
    );
  }
  if (!input.hasUnremittedCollections && input.balanceMinor <= 0) {
    throw new ConflictError("No tienes cobros ni efectivo por rendir", "NOTHING_TO_REMIT");
  }
}

/** Recepción del coordinador: el faltante queda en la caja de ruta como deuda. */
export function assessReception(input: { expectedMinor: number; countedMinor: number }): {
  shortfallMinor: number;
} {
  assertNonNegativeInteger(input.countedMinor, "El monto contado");
  if (input.countedMinor > input.expectedMinor) {
    throw new ConflictError(
      "Lo contado supera lo esperado: registra primero el cobro que falta",
      "COUNT_EXCEEDS_EXPECTED",
    );
  }
  return { shortfallMinor: input.expectedMinor - input.countedMinor };
}

/** Deuda arrastrada: saldo que quedó al último corte menos lo cerrado después. */
export function carriedDebtMinor(closingBalanceAtCutMinor: number, debtClosedAfterCutMinor: number): number {
  return Math.max(0, closingBalanceAtCutMinor - debtClosedAfterCutMinor);
}

/**
 * Cómo se cierra una deuda: PAYROLL = se recupera por nómina (no afecta la utilidad);
 * WRITE_OFF = se condona (pérdida que resta de la utilidad del período).
 */
export type DebtClosureType = "PAYROLL" | "WRITE_OFF";

/** Construye el asiento de cierre de deuda (solo ADMIN; la autorización la impone la frontera). */
export function buildDebtClosure(input: {
  debtMinor: number;
  amountMinor: number;
  type: DebtClosureType;
  reason: string;
  remittanceInProgress: boolean;
}): PostingIntent {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new DomainError("El monto a cerrar debe ser un entero positivo");
  }
  if (input.reason.trim().length === 0) {
    throw new DomainError("El cierre de deuda exige un motivo");
  }
  if (input.remittanceInProgress) {
    throw new ConflictError(
      "Hay una rendición por recibir: recíbela antes de cerrar deuda",
      "REMITTANCE_IN_PROGRESS",
    );
  }
  if (input.amountMinor > input.debtMinor) {
    throw new ConflictError("El monto supera la deuda arrastrada del cobrador", "DEBT_EXCEEDED");
  }
  return { direction: "OUT", kind: "DEBT_CLOSURE", amountMinor: input.amountMinor, reason: input.reason.trim() };
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(`${label} debe ser un entero no negativo`);
  }
}
