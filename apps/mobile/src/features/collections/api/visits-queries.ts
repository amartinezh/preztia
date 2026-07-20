import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VisitStatus } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { collectionKeys } from "./queries";

export const visitKeys = {
  all: ["collections", "visits"] as const,
  list: (status: VisitStatus) => [...visitKeys.all, "list", status] as const,
  log: (creditId: string) => [...visitKeys.all, "log", creditId] as const,
};

/** Clientes del cobrador por visitar (pending) o ya visitados en el ciclo vigente (visited). */
export function useCollectionVisits(status: VisitStatus) {
  return useQuery({
    queryKey: visitKeys.list(status),
    queryFn: async () =>
      unwrap(
        await api.listCollectionVisits({ headers: tenantHeader(), query: { status } }),
      ),
  });
}

/** Bitácora de visitas y observaciones de un crédito, ordenada por fecha. */
export function useCollectionLog(creditId: string) {
  return useQuery({
    queryKey: visitKeys.log(creditId),
    queryFn: async () =>
      unwrap(
        await api.listCollectionLog({ headers: tenantHeader(), params: { creditId } }),
      ),
  });
}

/** Agrega una observación de visita; refresca la bitácora y las listas (habilita "marcar visitado"). */
export function useAddObservation(creditId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) =>
      unwrap(
        await api.addCollectionObservation({
          headers: tenantHeader(),
          params: { creditId },
          body: { body },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: visitKeys.log(creditId) });
      void qc.invalidateQueries({ queryKey: visitKeys.all });
    },
  });
}

/** Marca el crédito como visitado; sale de Pendientes y aparece en Visitados. */
export function useMarkVisited(creditId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.markCollectionVisited({
          headers: tenantHeader(),
          params: { creditId },
          body: {},
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: visitKeys.all });
      void qc.invalidateQueries({ queryKey: visitKeys.log(creditId) });
      void qc.invalidateQueries({ queryKey: collectionKeys.panel(creditId) });
    },
  });
}
