import { useInfiniteQuery } from "@tanstack/react-query";
import type { CollectionTodayStatus } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

const PAGE_SIZE = 30;

export interface CollectionTodayParams {
  q?: string;
  status?: CollectionTodayStatus;
}

export const collectionTodayKeys = {
  all: ["collections", "today"] as const,
  list: (params: CollectionTodayParams) => [...collectionTodayKeys.all, "list", params] as const,
};

/**
 * Mis cobros de hoy: todos los clientes del cobrador con cuota, saldo, lo cobrado hoy y su estado,
 * paginados y con búsqueda en servidor. El resumen (cobrado / esperado / pendientes) viene en cada
 * página y es de toda la cartera, así que la primera página basta para la cabecera.
 */
export function useCollectionToday(params: CollectionTodayParams = {}) {
  return useInfiniteQuery({
    queryKey: collectionTodayKeys.list(params),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listCollectionToday({
          headers: tenantHeader(),
          query: {
            page: pageParam,
            pageSize: PAGE_SIZE,
            ...(params.q ? { q: params.q } : {}),
            ...(params.status ? { status: params.status } : {}),
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    // La lista cambia con cada abono: no conviene mostrarla rancia al volver del formulario.
    staleTime: 0,
  });
}
