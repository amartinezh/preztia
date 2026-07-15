import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateZoneInput, UpdateZoneInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const zoneKeys = {
  all: ["zones"] as const,
  tree: () => [...zoneKeys.all, "tree"] as const,
};

/** Árbol de zonas del tenant (sin paginar: decenas, no miles). */
export function useZonesList() {
  return useQuery({
    queryKey: zoneKeys.tree(),
    queryFn: async () => unwrap(await api.listZones({ headers: tenantHeader() })),
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateZoneInput) =>
      unwrap(await api.createZone({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: zoneKeys.all }),
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & UpdateZoneInput) =>
      unwrap(
        await api.updateZone({
          headers: tenantHeader(),
          params: { id: input.id },
          body: { name: input.name, supportPhone: input.supportPhone },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: zoneKeys.all }),
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.deleteZone({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: zoneKeys.all }),
  });
}

export function useAssignCoordinator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { zoneId: string; coordinatorId: string }) =>
      unwrap(
        await api.assignCoordinator({
          headers: tenantHeader(),
          params: { id: input.zoneId },
          body: { coordinatorId: input.coordinatorId },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: zoneKeys.all }),
  });
}
