import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export interface AccountsListParams {
  name?: string;
  nationalId?: string;
  phone?: string;
  onlyOverdue?: boolean;
}

const PAGE_SIZE = 20;

export const accountKeys = {
  all: ["accounts"] as const,
  list: (params: AccountsListParams) => [...accountKeys.all, "list", params] as const,
  detail: (creditId: string) => [...accountKeys.all, "detail", creditId] as const,
};

/** Listado de cuentas (créditos) con deuda y días de atraso, paginado. */
export function useAccountsList(params: AccountsListParams = {}) {
  return useInfiniteQuery({
    queryKey: accountKeys.list(params),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listAccounts({
          headers: tenantHeader(),
          query: {
            page: pageParam,
            pageSize: PAGE_SIZE,
            ...(params.name ? { name: params.name } : {}),
            ...(params.nationalId ? { nationalId: params.nationalId } : {}),
            ...(params.phone ? { phone: params.phone } : {}),
            ...(params.onlyOverdue ? { onlyOverdue: true } : {}),
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Detalle de una cuenta: cabecera + cronograma de cuotas. */
export function useAccountDetail(creditId: string) {
  return useQuery({
    queryKey: accountKeys.detail(creditId),
    queryFn: async () =>
      unwrap(await api.getAccountDetail({ headers: tenantHeader(), params: { creditId } })),
  });
}
