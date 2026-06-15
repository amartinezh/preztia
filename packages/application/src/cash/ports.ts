import type { ExpenseStatus } from "@preztiaos/domain";

// Puertos de salida del bounded context CASH (gastos + liquidación). La infraestructura los
// implementa con Drizzle bajo el rol `app` + RLS. Aquí solo se DECLARAN.

// --- Gastos -----------------------------------------------------------------

export interface NewExpense {
  readonly id: string;
  readonly tenantId: string;
  readonly requestedBy: string;
  readonly description: string;
  readonly amountMinor: number;
}

export interface ExpenseRecord {
  readonly id: string;
  readonly requestedBy: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly status: ExpenseStatus;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

export interface ExpenseStore {
  create(expense: NewExpense): Promise<void>;
  findById(input: { tenantId: string; expenseId: string }): Promise<ExpenseRecord | null>;
  /** Persiste la decisión de revisión; `null` si el gasto no existe en el tenant. */
  updateReview(input: {
    tenantId: string;
    expenseId: string;
    status: ExpenseStatus;
    reviewedBy: string;
    reviewedAt: Date;
  }): Promise<ExpenseRecord | null>;
}

// --- Liquidación (caja) -----------------------------------------------------

/** Totales del período calculados sobre la ventana (periodStart, periodEnd]. */
export interface WindowTotals {
  readonly totalCobradoMinor: number;
  readonly totalPrestadoMinor: number;
  readonly gastosMinor: number;
  readonly cuentasNuevas: number;
  readonly cuentasTerminadas: number;
}

export interface NewSettlement {
  readonly id: string;
  readonly tenantId: string;
  readonly closedBy: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly cajaAnteriorMinor: number;
  readonly totalCobradoMinor: number;
  readonly totalPrestadoMinor: number;
  readonly gastosMinor: number;
  readonly cajaActualMinor: number;
  readonly cuentasNuevas: number;
  readonly cuentasTerminadas: number;
}

export interface SettlementStore {
  /** Última liquidada del tenant: su saldo de cierre y el fin de su ventana. */
  findLast(tenantId: string): Promise<{ cajaActualMinor: number; periodEnd: Date } | null>;
  /** Calcula los totales de movimientos en la ventana (periodStart, periodEnd]. */
  computeWindowTotals(input: {
    tenantId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<WindowTotals>;
  create(settlement: NewSettlement): Promise<void>;
}
