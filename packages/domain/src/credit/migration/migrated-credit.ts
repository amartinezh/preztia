import { DomainError, Money } from "../../shared/money";
import { allocatePayment, type PaymentAllocation } from "../portfolio/allocate-payment";
import type { PortfolioInstallment } from "../portfolio/installment";

// Regla pura de la CARGA DE UN CRÉDITO MIGRADO del sistema anterior, sin I/O.
//
// Un crédito migrado es deuda que YA existe: empezó en el pasado y ya recibió abonos. No es un
// otorgamiento: no sale dinero de ninguna caja hoy, ni entran hoy los abonos históricos (ese
// dinero se movió en el sistema anterior). Su cronograma se calcula desde su fecha de inicio y
// los abonos históricos se reparten en cascada, igual que cualquier pago, en orden de fecha.
//
// Invariantes (probadas):
// - fecha de inicio ≤ hoy; cada abono con fecha entre el inicio y hoy (nunca futuro);
// - Σ abonos históricos ≤ total del crédito (no hay saldo a favor inventado);
// - Σ asignado = Σ abonos (no se pierde un centavo) y ninguna cuota supera lo debido.

/** Tope de abonos históricos por crédito en una sola carga. */
export const MAX_HISTORICAL_PAYMENTS = 500;

export interface HistoricalPayment {
  /** Día del abono en el sistema anterior (YYYY-MM-DD). */
  readonly paidOn: string;
  readonly amountMinor: number;
}

export interface PlannedHistoricalPayment extends HistoricalPayment {
  readonly allocations: readonly PaymentAllocation[];
}

export interface MigrationPlan {
  /** Abonos en orden de fecha, cada uno con su reparto en las cuotas. */
  readonly payments: readonly PlannedHistoricalPayment[];
  /** Estado final de las cuotas tras los abonos históricos. */
  readonly installments: readonly PortfolioInstallment[];
  readonly paidMinor: number;
  readonly settled: boolean;
}

/**
 * Valida la carga y reparte los abonos históricos sobre el cronograma (cuotas recién calculadas,
 * sin abonos). Falla rápido con `DomainError` (400) ante fechas futuras, abonos fuera del crédito o
 * un total abonado mayor que lo debido.
 */
export function planMigratedCredit(input: {
  readonly startDate: string;
  /** Hoy en la zona horaria del tenant (YYYY-MM-DD). */
  readonly today: string;
  readonly currency: string;
  readonly installments: readonly PortfolioInstallment[];
  readonly payments: readonly HistoricalPayment[];
}): MigrationPlan {
  if (input.startDate > input.today) {
    throw new DomainError("La fecha de inicio de un crédito migrado no puede ser futura");
  }
  if (input.payments.length > MAX_HISTORICAL_PAYMENTS) {
    throw new DomainError(`Un crédito migrado admite hasta ${MAX_HISTORICAL_PAYMENTS} abonos históricos`);
  }
  for (const p of input.payments) assertHistoricalPayment(p, input.startDate, input.today);

  const totalDue = input.installments.reduce((acc, i) => acc + i.amountDueMinor, 0);
  const paidMinor = input.payments.reduce((acc, p) => acc + p.amountMinor, 0);
  if (paidMinor > totalDue) {
    throw new DomainError("Los abonos históricos superan el total del crédito");
  }

  // Orden estable por fecha: el reparto en cascada sigue el orden real de los abonos.
  const ordered = [...input.payments].sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0));
  let installments = input.installments;
  const payments: PlannedHistoricalPayment[] = [];
  for (const payment of ordered) {
    const result = allocatePayment(input.currency, installments, Money.of(payment.amountMinor, input.currency));
    installments = result.installments;
    payments.push({ ...payment, allocations: result.allocations });
  }
  return { payments, installments, paidMinor, settled: paidMinor === totalDue && totalDue > 0 };
}

function assertHistoricalPayment(p: HistoricalPayment, startDate: string, today: string): void {
  if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0) {
    throw new DomainError("Cada abono histórico debe ser un monto entero mayor a cero");
  }
  if (p.paidOn < startDate || p.paidOn > today) {
    throw new DomainError(`El abono del ${p.paidOn} debe estar entre el inicio del crédito y hoy`);
  }
}
