import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateExpenseInput, ExpenseStatus } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const cashKeys = {
  all: ["cash"] as const,
  expenses: (status?: ExpenseStatus) => [...cashKeys.all, "expenses", status ?? "all"] as const,
  settlements: () => [...cashKeys.all, "settlements"] as const,
  preview: () => [...cashKeys.all, "preview"] as const,
  daily: () => [...cashKeys.all, "daily"] as const,
};

const PAGE_SIZE = 20;

export function useDailyReport() {
  return useQuery({
    queryKey: cashKeys.daily(),
    queryFn: async () => unwrap(await api.getDailyReport({ headers: tenantHeader(), query: {} })),
  });
}

export function useExpensesList(status?: ExpenseStatus) {
  return useQuery({
    queryKey: cashKeys.expenses(status),
    queryFn: async () =>
      unwrap(
        await api.listExpenses({
          headers: tenantHeader(),
          query: { page: 1, pageSize: PAGE_SIZE, ...(status ? { status } : {}) },
        }),
      ),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) =>
      unwrap(await api.createExpense({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cashKeys.all }),
  });
}

export function useReviewExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) =>
      unwrap(
        await api.reviewExpense({
          headers: tenantHeader(),
          params: { id: input.id },
          body: { approve: input.approve },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cashKeys.all }),
  });
}

export function useSettlementPreview() {
  return useQuery({
    queryKey: cashKeys.preview(),
    queryFn: async () => unwrap(await api.previewSettlement({ headers: tenantHeader() })),
  });
}

export function useSettlementsList() {
  return useQuery({
    queryKey: cashKeys.settlements(),
    queryFn: async () =>
      unwrap(await api.listSettlements({ headers: tenantHeader(), query: { page: 1, pageSize: PAGE_SIZE } })),
  });
}

export function useCloseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.closeSettlement({ headers: tenantHeader(), body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cashKeys.all }),
  });
}
