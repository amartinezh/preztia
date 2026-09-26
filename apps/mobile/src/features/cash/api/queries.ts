import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXPENSE_RECEIPT_FIELD, type ExpenseStatus } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { appendPickedFile, type PickedFile } from "@/core/api/multipart";
import { cashBoxKeys } from "./boxes-queries";
import { remittanceKeys } from "@/features/remittances/api/queries";

export const cashKeys = {
  all: ["cash"] as const,
  expenses: (status?: ExpenseStatus) => [...cashKeys.all, "expenses", status ?? "all"] as const,
  daily: () => [...cashKeys.all, "daily"] as const,
};

const PAGE_SIZE = 20;

export function useDailyReport() {
  return useQuery({
    queryKey: cashKeys.daily(),
    queryFn: async () => unwrap(await api.getDailyReport({ headers: tenantHeader(), query: {} })),
  });
}

/** Gastos dentro del alcance (el servidor lo impone: el cobrador solo ve los suyos). Paginado. */
export function useExpensesList(status?: ExpenseStatus) {
  return useInfiniteQuery({
    queryKey: cashKeys.expenses(status),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listExpenses({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE, ...(status ? { status } : {}) },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Comprobante elegido para el gasto. */
export type PickedReceipt = PickedFile;

async function toExpenseForm(input: {
  description: string;
  amountMinor: number;
  receipt: PickedReceipt;
}): Promise<FormData> {
  const form = new FormData();
  form.append("description", input.description);
  form.append("amountMinor", String(input.amountMinor));
  await appendPickedFile(form, EXPENSE_RECEIPT_FIELD, input.receipt);
  return form;
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { description: string; amountMinor: number; receipt: PickedReceipt }) =>
      unwrap(await api.createExpense({ headers: tenantHeader(), body: await toExpenseForm(input) })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cashKeys.all }),
  });
}

export function useReviewExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      approve: boolean;
      paidFromCashBoxId?: string;
      rejectionReason?: string;
    }) =>
      unwrap(
        await api.reviewExpense({
          headers: tenantHeader(),
          params: { id: input.id },
          body: {
            approve: input.approve,
            ...(input.paidFromCashBoxId ? { paidFromCashBoxId: input.paidFromCashBoxId } : {}),
            ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
          },
        }),
      ),
    // Aprobar mueve dinero: también cambian los saldos de las cajas y la rendición del cobrador.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cashKeys.all });
      void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
      void qc.invalidateQueries({ queryKey: remittanceKeys.all });
    },
  });
}
