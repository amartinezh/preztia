// Dominio puro del GASTO de cobro ("Solicitud Gastos" del legado): el cobrador solicita, el
// socio/coordinador aprueba o rechaza (maker-checker). Solo los gastos APROBADOS afectan la caja.

import { DomainError } from "../shared/money";
import { assertCanPayOnBehalfOf, type PayingBox } from "./ledger-attribution";
import { assertValidReceiptFile, RECEIPT_MAX_BYTES, RECEIPT_MIME_TYPES } from "../shared/receipt-file";

export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED";

/** El gasto debe ser un entero positivo en unidades menores. */
export function assertExpenseAmountMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new DomainError("El gasto debe ser un entero positivo en unidades menores");
  }
}

/**
 * Resuelve la revisión de un gasto. Solo un gasto PENDING puede revisarse (transición única,
 * sin reaprobaciones que descuadren la caja). Devuelve el nuevo estado.
 */
export function decideExpense(current: ExpenseStatus, approve: boolean): ExpenseStatus {
  if (current !== "PENDING") {
    throw new DomainError("El gasto ya fue revisado");
  }
  return approve ? "APPROVED" : "REJECTED";
}

/** Longitud mínima del motivo de rechazo (igual que los demás motivos del sistema). */
const MIN_REJECTION_REASON_LENGTH = 3;

/**
 * Revisión de un gasto (maker-checker): solo un PENDING se revisa, y rechazar exige un motivo
 * (queda en el historial del cobrador para aclarar malentendidos).
 */
export function reviewExpense(input: {
  current: ExpenseStatus;
  approve: boolean;
  rejectionReason?: string;
}): { status: ExpenseStatus; rejectionReason: string | null } {
  const status = decideExpense(input.current, input.approve);
  if (input.approve) return { status, rejectionReason: null };
  const reason = input.rejectionReason?.trim() ?? "";
  if (reason.length < MIN_REJECTION_REASON_LENGTH) {
    throw new DomainError("Rechazar un gasto exige un motivo");
  }
  return { status, rejectionReason: reason };
}

/** El comprobante del gasto sigue la regla común de comprobantes (foto o PDF, ≤ 8 MB). */
export const EXPENSE_RECEIPT_MAX_BYTES = RECEIPT_MAX_BYTES;
export const EXPENSE_RECEIPT_MIME_TYPES = RECEIPT_MIME_TYPES;
export const assertValidExpenseReceipt = assertValidReceiptFile;

/**
 * ¿De qué caja puede salir el dinero del gasto? De una caja de oficina o banco que la zona del gasto
 * puede usar (propia, superior o del tenant), o de la caja de ruta de QUIEN lo pidió (se descuenta
 * de su efectivo y entra en su rendición). Nunca de la caja de ruta de otro cobrador: le
 * descuadraría la rendición. Un gasto sin zona solo se paga con cajas del tenant.
 */
export function assertCanPayExpenseFrom(input: {
  requestedBy: string;
  expenseZonePath: string | null;
  box: PayingBox;
}): void {
  assertCanPayOnBehalfOf(
    { beneficiaryId: input.requestedBy, zonePath: input.expenseZonePath, box: input.box },
    {
      foreignRouteBoxMessage: "No se puede pagar un gasto desde la caja de ruta de otro cobrador",
      foreignRouteBoxCode: "EXPENSE_BOX_NOT_ALLOWED",
      noZoneMessage: "Un gasto sin zona se paga con una caja general del tenant",
    },
  );
}
