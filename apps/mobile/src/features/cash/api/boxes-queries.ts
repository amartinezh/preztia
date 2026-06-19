import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BankAccountInput, CashBoxType } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

/** Patch parcial de una cuenta (null borra pixKey/apiKey/accountNumber). */
export interface BankAccountPatch {
  label?: string;
  bankName?: string;
  accountNumber?: string | null;
  pixKey?: string | null;
  apiKey?: string | null;
  unverifiedPolicy?: "HOLD" | "ALLOCATE";
  active?: boolean;
}

const PAGE_SIZE = 20;

export const cashBoxKeys = {
  all: ["cash-boxes"] as const,
  dashboard: () => [...cashBoxKeys.all, "dashboard"] as const,
  boxes: () => [...cashBoxKeys.all, "boxes"] as const,
  accounts: () => [...cashBoxKeys.all, "accounts"] as const,
  transactions: (f: TransactionFilters) =>
    [...cashBoxKeys.all, "transactions", f] as const,
};

export interface TransactionFilters {
  cashBoxId?: string;
  kind?:
    | "PAYMENT_IN"
    | "WITHDRAWAL"
    | "EXPENSE"
    | "TRANSFER"
    | "ADJUSTMENT"
    | "UNIDENTIFIED";
  direction?: "IN" | "OUT";
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
            ...(filters.cashBoxId ? { cashBoxId: filters.cashBoxId } : {}),
            ...(filters.kind ? { kind: filters.kind } : {}),
            ...(filters.direction ? { direction: filters.direction } : {}),
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
    mutationFn: async (input: { type: CashBoxType; name: string; bankAccountId?: string }) =>
      unwrap(
        await api.createCashBox({
          headers: tenantHeader(),
          body: {
            type: input.type,
            name: input.name,
            ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
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
