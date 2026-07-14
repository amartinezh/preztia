import type { BankBalanceVerdict, ExpenseStatus } from "@preztiaos/domain";

// Puertos de salida del bounded context CASH (gastos + conciliación bancaria). La infraestructura
// los implementa con Drizzle bajo el rol `app` + RLS. Aquí solo se DECLARAN.

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
  /**
   * Persiste la decisión de revisión; `null` si el gasto no existe en el tenant. Al APROBAR con
   * `paidFromCashBoxId`, debita el gasto de esa caja/cuenta (asiento EXPENSE OUT) en la MISMA
   * transacción: si el saldo no alcanza, todo se revierte (sin gasto aprobado sin egreso).
   */
  updateReview(input: {
    tenantId: string;
    expenseId: string;
    status: ExpenseStatus;
    reviewedBy: string;
    reviewedAt: Date;
    /** Caja/cuenta pagadora (presente solo al aprobar). */
    paidFromCashBoxId?: string;
  }): Promise<ExpenseRecord | null>;
}

// --- Conciliación bancaria en línea (Req 7) ---------------------------------

/**
 * Puerto: consulta el saldo REAL de una cuenta bancaria. La infraestructura resuelve el
 * adaptador por (countryCode, bankCode) — igual que BankPaymentVerifier — y la autenticación
 * (API key/OAuth/mTLS) es un detalle del adaptador. Nunca lanza hacia el caso de uso: cualquier
 * fallo se degrada a `unavailable` para que la conciliación no rompa la operación.
 */
export interface BankBalanceProvider {
  fetchBalance(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
    apiKey: string | null;
  }): Promise<BankBalanceVerdict>;
}
