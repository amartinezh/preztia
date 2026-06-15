import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateOperationalSettingsInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const settingsKeys = {
  all: ["tenant-config"] as const,
  operational: () => [...settingsKeys.all, "operational"] as const,
};

export function useOperationalSettings() {
  return useQuery({
    queryKey: settingsKeys.operational(),
    queryFn: async () =>
      unwrap(await api.getOperationalSettings({ headers: tenantHeader() })),
  });
}

export function useUpdateOperationalSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateOperationalSettingsInput) =>
      unwrap(await api.updateOperationalSettings({ headers: tenantHeader(), body: patch })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}
