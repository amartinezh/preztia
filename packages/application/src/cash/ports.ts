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
  /** Comprobante ya guardado (cifrado) por el `ExpenseReceiptStorage`. */
  readonly receipt: StoredExpenseReceipt;
}

export interface StoredExpenseReceipt {
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sha256: string;
}

export interface ExpenseRecord {
  readonly id: string;
  readonly requestedBy: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly status: ExpenseStatus;
  /** Ruta de la zona del gasto (alcance del coordinador); null = gasto del tenant. */
  readonly zonePath: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
}

export interface ExpenseStore {
  /**
   * Crea la solicitud PENDING. La zona del gasto la resuelve la infraestructura: es la de la caja
   * de ruta de quien lo pide (NULL si no tiene caja de ruta).
   */
  create(expense: NewExpense): Promise<void>;
  findById(input: { tenantId: string; expenseId: string }): Promise<ExpenseRecord | null>;
  /**
   * Persiste la decisión de revisión; `null` si el gasto no existe en el tenant. Al APROBAR con
   * `paidFromCashBoxId`, debita el gasto de esa caja/cuenta (asiento EXPENSE OUT) en la MISMA
   * transacción, verificando que esa caja pueda pagarlo (`assertCanPayExpenseFrom`): si no puede
   * o el saldo no alcanza, todo se revierte (sin gasto aprobado sin egreso).
   */
  updateReview(input: {
    tenantId: string;
    expenseId: string;
    status: ExpenseStatus;
    reviewedBy: string;
    reviewedAt: Date;
    rejectionReason: string | null;
    /** Caja/cuenta pagadora (presente solo al aprobar). */
    paidFromCashBoxId?: string;
  }): Promise<ExpenseRecord | null>;
}

/** Puerto: guarda el comprobante del gasto CIFRADO en reposo (evidencia; nunca se loguea). */
export interface ExpenseReceiptStorage {
  store(input: {
    tenantId: string;
    expenseId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<StoredExpenseReceipt>;
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
