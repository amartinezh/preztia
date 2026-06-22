import { useMutation, useQuery } from "@tanstack/react-query";
import type { CriticalRouteOutput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const mapKeys = {
  all: ["collections", "map"] as const,
  criticalClients: () => [...mapKeys.all, "critical-clients"] as const,
};

/** Clientes en mora crítica (≥ umbral de cuotas vencidas) con coordenadas, para el mapa de cobro. */
export function useCriticalClients() {
  return useQuery({
    queryKey: mapKeys.criticalClients(),
    queryFn: async () =>
      unwrap(await api.listCriticalClients({ headers: tenantHeader() })),
  });
}

/** Genera la ruta de cobro óptima (OSRM) desde la posición del cobrador hacia los clientes críticos. */
export function useCriticalRoute() {
  return useMutation<CriticalRouteOutput, unknown, { latitude: number; longitude: number }>({
    mutationFn: async (start) =>
      unwrap(
        await api.criticalRoute({ headers: tenantHeader(), body: { start } }),
      ),
  });
}
