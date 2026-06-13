import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrantCreditInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

const PAGE_SIZE = 20;

export const creditKeys = {
  all: ["credits"] as const,
  list: () => [...creditKeys.all, "list"] as const,
  portfolio: (creditId: string) => [...creditKeys.all, "portfolio", creditId] as const,
};

/** Lista paginada de créditos (paginación obligatoria, §3.7). */
export function useCreditsList() {
  return useInfiniteQuery({
    queryKey: creditKeys.list(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listCredits({ headers: tenantHeader(), query: { page: pageParam, pageSize: PAGE_SIZE } })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Cartera de cuotas y saldo de un crédito. */
export function useCreditPortfolio(creditId: string) {
  return useQuery({
    queryKey: creditKeys.portfolio(creditId),
    queryFn: async () => unwrap(await api.getCreditPortfolio({ headers: tenantHeader(), params: { creditId } })),
  });
}

/** Otorga un crédito. Refresca la lista al tener éxito. */
export function useGrantCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GrantCreditInput) =>
      unwrap(await api.grantCredit({ headers: tenantHeader(), body: input })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creditKeys.list() });
    },
  });
}
