import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { CreditStatus } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export interface AccountsListParams {
  /** Búsqueda unificada en servidor: nombre, cédula o teléfono (OR). */
  q?: string;
  name?: string;
  nationalId?: string;
  phone?: string;
  onlyOverdue?: boolean;
  /** Estado del crédito, filtrado en servidor (no sobre las páginas ya cargadas). */
  status?: CreditStatus;
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
            ...(params.q ? { q: params.q } : {}),
            ...(params.name ? { name: params.name } : {}),
            ...(params.nationalId ? { nationalId: params.nationalId } : {}),
            ...(params.phone ? { phone: params.phone } : {}),
            ...(params.onlyOverdue ? { onlyOverdue: true } : {}),
            ...(params.status ? { status: params.status } : {}),
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
