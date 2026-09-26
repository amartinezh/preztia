import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BankAccountInput,
  BankProviderType,
  BankReportConfig,
  CashBoxType,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

/** Patch parcial de una cuenta (null borra el valor; ausente no toca). */
export interface BankAccountPatch {
  label?: string;
  bankName?: string;
  accountNumber?: string | null;
  providerType?: BankProviderType;
  pixKey?: string | null;
  receiverTaxId?: string | null;
  receiverName?: string | null;
  apiKey?: string | null;
  // Secretos del proveedor (ej. Mercado Pago): nunca se leen de vuelta.
  publicKey?: string | null;
  accessToken?: string | null;
  webhookSecret?: string | null;
  reportConfig?: BankReportConfig | null;
  unverifiedPolicy?: "HOLD" | "ALLOCATE";
  active?: boolean;
}

const PAGE_SIZE = 20;

export const cashBoxKeys = {
  all: ["cash-boxes"] as const,
  dashboard: () => [...cashBoxKeys.all, "dashboard"] as const,
  funding: (zoneId: string) => [...cashBoxKeys.all, "funding", zoneId] as const,
  mine: () => [...cashBoxKeys.all, "mine"] as const,
  boxes: () => [...cashBoxKeys.all, "boxes"] as const,
  accounts: () => [...cashBoxKeys.all, "accounts"] as const,
  transactions: (f: TransactionFilters) =>
    [...cashBoxKeys.all, "transactions", f] as const,
};

export interface TransactionFilters {
  cashBoxId?: string;
  kind?:
    | "PAYMENT_IN"
    | "DISBURSEMENT"
    | "WITHDRAWAL"
    | "EXPENSE"
    | "TRANSFER"
    | "ADJUSTMENT"
    | "UNIDENTIFIED"
    | "DEBT_CLOSURE";
  direction?: "IN" | "OUT";
  /** Cobrador dueño de la caja (su efectivo de ruta). */
  collectorId?: string;
  /** Cliente que causa el movimiento (abonos vía pago, desembolsos vía crédito). */
  borrowerId?: string;
  /** Rango de fechas (datetime ISO inclusivo): desde el inicio y hasta el fin del día. */
  from?: string;
  to?: string;
  /** Corte EXCLUSIVO (< before): el detalle de una liquidación calza con su [inicio, fin). */
  before?: string;
  /** Zona sellada en el asiento. */
  zoneId?: string;
}

/** Filtros del libro como parámetros de consulta (solo los presentes). */
export function transactionQuery(filters: TransactionFilters): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
  );
}

// --- Lecturas ---------------------------------------------------------------

/** Dashboard financiero: saldo total + por caja (con última conciliación). */
export function useCashDashboard() {
  return useQuery({
    queryKey: cashBoxKeys.dashboard(),
    queryFn: async () =>
      unwrap(await api.getCashDashboard({ headers: tenantHeader() })),
  });
}

/** Cajas/cuentas que la zona puede usar para desembolsar (el servidor aplica la regla). */
export function useFundingBoxes(zoneId: string | null) {
  return useQuery({
    queryKey: cashBoxKeys.funding(zoneId ?? ""),
    enabled: !!zoneId,
    queryFn: async () =>
      unwrap(
        await api.listFundingBoxes({ headers: tenantHeader(), query: { zoneId: zoneId! } }),
      ),
  });
}

/** Caja de ruta del usuario autenticado (efectivo en su poder); `box: null` si no tiene. */
export function useMyCashBox() {
  return useQuery({
    queryKey: cashBoxKeys.mine(),
    queryFn: async () => unwrap(await api.getMyCashBox({ headers: tenantHeader() })),
  });
}

export function useCashBoxes() {
  return useQuery({
    queryKey: cashBoxKeys.boxes(),
    queryFn: async () =>
      unwrap(await api.listCashBoxes({ headers: tenantHeader() })),
  });
}

export function useBankAccounts() {
  return useQuery({
    queryKey: cashBoxKeys.accounts(),
    queryFn: async () =>
      unwrap(await api.listBankAccounts({ headers: tenantHeader() })),
  });
}

/** Historial de movimientos con filtros, paginado (infinite). */
export function useCashTransactions(filters: TransactionFilters = {}) {
  return useInfiniteQuery({
    queryKey: cashBoxKeys.transactions(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listCashTransactions({
          headers: tenantHeader(),
          query: {
            page: pageParam,
            pageSize: PAGE_SIZE,
            ...transactionQuery(filters),
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

// --- Mutaciones -------------------------------------------------------------

function useInvalidateCash() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
}

export function useRegisterWithdrawal() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: { boxId: string; amountMinor: number; reason: string }) =>
      unwrap(
        await api.registerWithdrawal({
          headers: tenantHeader(),
          params: { id: input.boxId },
          body: { amountMinor: input.amountMinor, reason: input.reason },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useTransfer() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: {
      fromBoxId: string;
      toBoxId: string;
      amountMinor: number;
      reason: string;
    }) => unwrap(await api.transfer({ headers: tenantHeader(), body: input })),
    onSuccess: invalidate,
  });
}

export function usePerformCashCount() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: { boxId: string; countedMinor: number; notes?: string }) =>
      unwrap(
        await api.performCashCount({
          headers: tenantHeader(),
          params: { id: input.boxId },
          body: {
            countedMinor: input.countedMinor,
            ...(input.notes ? { notes: input.notes } : {}),
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Ajusta el saldo de la caja al valor de un arqueo (asiento ADJUSTMENT con motivo). */
export function useAdjustCashBalance() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: { boxId: string; cashCountId: string; reason: string }) =>
      unwrap(
        await api.adjustCashBalance({
          headers: tenantHeader(),
          params: { id: input.boxId },
          body: { cashCountId: input.cashCountId, reason: input.reason },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useSyncBankBalance() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (boxId: string) =>
      unwrap(
        await api.syncBankBalance({
          headers: tenantHeader(),
          params: { id: boxId },
          body: {},
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useCreateCashBox() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: {
      type: CashBoxType;
      name: string;
      bankAccountId?: string;
      assignedTo?: string;
      zoneId?: string;
    }) =>
      unwrap(
        await api.createCashBox({
          headers: tenantHeader(),
          body: {
            type: input.type,
            name: input.name,
            ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
            ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
            ...(input.zoneId ? { zoneId: input.zoneId } : {}),
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Edita una caja: nombre, cobrador y/o zona (null desvincula). */
export function useUpdateCashBox() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      assignedTo?: string | null;
      zoneId?: string | null;
    }) =>
      unwrap(
        await api.updateCashBox({
          headers: tenantHeader(),
          params: { id: input.id },
          body: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
            ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteCashBox() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (boxId: string) =>
      unwrap(
        await api.deleteCashBox({ headers: tenantHeader(), params: { id: boxId }, body: {} }),
      ),
    onSuccess: invalidate,
  });
}

export function useCreateBankAccount() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: BankAccountInput) =>
      unwrap(await api.createBankAccount({ headers: tenantHeader(), body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdateBankAccount() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (input: { id: string; patch: BankAccountPatch }) =>
      unwrap(
        await api.updateBankAccount({
          headers: tenantHeader(),
          params: { id: input.id },
          body: input.patch,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteBankAccount() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: async (accountId: string) =>
      unwrap(
        await api.deleteBankAccount({
          headers: tenantHeader(),
          params: { id: accountId },
          body: {},
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Prueba las credenciales del proveedor (ej. Mercado Pago) sin exponer el secreto. */
export function useVerifyBankCredentials() {
  return useMutation({
    mutationFn: async (accountId: string) =>
      unwrap(
        await api.verifyBankCredentials({
          headers: tenantHeader(),
          params: { id: accountId },
          body: {},
        }),
      ),
  });
}
