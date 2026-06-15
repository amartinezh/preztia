import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateBorrowerInput, UpdateBorrowerInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export interface BorrowersListParams {
  page?: number;
  name?: string;
  withoutCredits?: boolean;
}

export const borrowerKeys = {
  all: ["borrowers"] as const,
  list: (params: BorrowersListParams) => [...borrowerKeys.all, "list", params] as const,
};

const PAGE_SIZE = 20;

/** Lista paginada de clientes del tenant, con filtros de nombre y "sin créditos". */
export function useBorrowersList(params: BorrowersListParams = {}) {
  return useQuery({
    queryKey: borrowerKeys.list(params),
    queryFn: async () =>
      unwrap(
        await api.listBorrowers({
          headers: tenantHeader(),
          query: {
            page: params.page ?? 1,
            pageSize: PAGE_SIZE,
            ...(params.name ? { name: params.name } : {}),
            ...(params.withoutCredits ? { withoutCredits: true } : {}),
          },
        }),
      ),
  });
}

export function useCreateBorrower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBorrowerInput) =>
      unwrap(await api.createBorrower({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: borrowerKeys.all }),
  });
}

export function useUpdateBorrower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: UpdateBorrowerInput }) =>
      unwrap(
        await api.updateBorrower({
          headers: tenantHeader(),
          params: { id: input.id },
          body: input.patch,
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: borrowerKeys.all }),
  });
}
