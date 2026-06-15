import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecordLocationInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const trackingKeys = {
  all: ["tracking"] as const,
  positions: () => [...trackingKeys.all, "positions"] as const,
  track: (collectorId: string) => [...trackingKeys.all, "track", collectorId] as const,
  last: (collectorId: string) => [...trackingKeys.all, "last", collectorId] as const,
};

/** Posición de clientes (deudores geolocalizados) con su estado. */
export function useClientPositions() {
  return useQuery({
    queryKey: trackingKeys.positions(),
    queryFn: async () => unwrap(await api.getClientPositions({ headers: tenantHeader() })),
  });
}

export function useCollectorTrack(collectorId: string) {
  return useQuery({
    queryKey: trackingKeys.track(collectorId),
    queryFn: async () =>
      unwrap(
        await api.getCollectorTrack({ headers: tenantHeader(), params: { id: collectorId }, query: {} }),
      ),
  });
}

/** Registra la posición del cobrador autenticado. */
export function useRecordLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordLocationInput) =>
      unwrap(await api.recordLocation({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: trackingKeys.all }),
  });
}
