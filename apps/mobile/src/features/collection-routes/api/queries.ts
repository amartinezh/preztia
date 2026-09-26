import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DispatchRouteInput, ResolveStopInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { cashBoxKeys } from "@/features/cash/api/boxes-queries";
import { remittanceKeys } from "@/features/remittances/api/queries";

const PAGE_SIZE = 20;

export const routeKeys = {
  all: ["collection-routes"] as const,
  proposal: (zoneId: string) => [...routeKeys.all, "proposal", zoneId] as const,
  list: () => [...routeKeys.all, "list"] as const,
  detail: (id: string) => [...routeKeys.all, "detail", id] as const,
  myStops: (status: "open" | "done") => [...routeKeys.all, "mine", status] as const,
};

/** Propuesta de ruta de la zona (clientes que necesitan visita, en orden de recorrido). */
export function useRouteProposal(zoneId: string | null) {
  return useQuery({
    queryKey: routeKeys.proposal(zoneId ?? ""),
    enabled: !!zoneId,
    queryFn: async () =>
      unwrap(await api.getRouteProposal({ headers: tenantHeader(), query: { zoneId: zoneId! } })),
  });
}

export function useDispatchRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: DispatchRouteInput) =>
      unwrap(await api.dispatchRoute({ headers: tenantHeader(), body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: routeKeys.all }),
  });
}

export function useRoutes() {
  return useInfiniteQuery({
    queryKey: routeKeys.list(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listCollectionRoutes({ headers: tenantHeader(), query: { page: pageParam, pageSize: PAGE_SIZE } })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useRouteDetail(routeId: string | null) {
  return useQuery({
    queryKey: routeKeys.detail(routeId ?? ""),
    enabled: !!routeId,
    queryFn: async () => unwrap(await api.getCollectionRoute({ headers: tenantHeader(), params: { id: routeId! } })),
  });
}

export function useCancelRouteStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      unwrap(await api.cancelRouteStop({ headers: tenantHeader(), params: { id }, body: { reason } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: routeKeys.all }),
  });
}

/** Paradas del cobrador: abiertas (vista mínima) o su historial. */
export function useMyRouteStops(status: "open" | "done") {
  return useInfiniteQuery({
    queryKey: routeKeys.myStops(status),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listMyRouteStops({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE, status },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useMarkRouteStopSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.markRouteStopSeen({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: routeKeys.all }),
  });
}

/** Liquidar la visita: si pagó, el cobro entra a la caja de ruta (cambian caja y rendición). */
export function useResolveRouteStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & ResolveStopInput) =>
      unwrap(await api.resolveRouteStop({ headers: tenantHeader(), params: { id }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: routeKeys.all });
      void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
      void qc.invalidateQueries({ queryKey: remittanceKeys.all });
    },
  });
}
