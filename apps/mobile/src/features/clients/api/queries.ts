import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";

const PAGE_SIZE = 20;

export const clientKeys = {
  all: ["clients"] as const,
  mine: () => [...clientKeys.all, "mine"] as const,
  assignable: (collectorId: string) =>
    [...clientKeys.all, "assignable", collectorId] as const,
};

/** Clientes asignados al cobrador autenticado (su cartera). */
export function useMyClients() {
  return useInfiniteQuery({
    queryKey: clientKeys.mine(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listMyClients({ headers: tenantHeader(), query: { page: pageParam, pageSize: PAGE_SIZE } })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Clientes dentro del alcance del coordinador, marcando los ya asignados al cobrador. */
export function useAssignableClients(collectorId: string) {
  return useInfiniteQuery({
    queryKey: clientKeys.assignable(collectorId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listAssignableClients({
          headers: tenantHeader(),
          params: { id: collectorId },
          query: { page: pageParam, pageSize: PAGE_SIZE },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Reemplaza la cartera de clientes del cobrador. */
export function useAssignClients(collectorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (borrowerIds: string[]) =>
      unwrap(
        await api.assignClients({
          headers: tenantHeader(),
          params: { id: collectorId },
          body: { borrowerIds },
        }),
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: clientKeys.assignable(collectorId) }),
  });
}
