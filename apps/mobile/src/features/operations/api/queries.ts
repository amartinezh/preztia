import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequestStatus, CreateChangeRequestInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const operationsKeys = {
  all: ["operations"] as const,
  changeRequests: (status?: ChangeRequestStatus) =>
    [...operationsKeys.all, "change-requests", status ?? "all"] as const,
  routes: () => [...operationsKeys.all, "routes"] as const,
};

export function useChangeRequests(status?: ChangeRequestStatus) {
  return useQuery({
    queryKey: operationsKeys.changeRequests(status),
    queryFn: async () =>
      unwrap(
        await api.listChangeRequests({
          headers: tenantHeader(),
          query: { page: 1, pageSize: 20, ...(status ? { status } : {}) },
        }),
      ),
  });
}

export function useCreateChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateChangeRequestInput) =>
      unwrap(await api.createChangeRequest({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: operationsKeys.all }),
  });
}

export function useReviewChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) =>
      unwrap(
        await api.reviewChangeRequest({
          headers: tenantHeader(),
          params: { id: input.id },
          body: { approve: input.approve },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: operationsKeys.all }),
  });
}

export function useRoutes() {
  return useQuery({
    queryKey: operationsKeys.routes(),
    queryFn: async () => unwrap(await api.listRoutes({ headers: tenantHeader() })),
  });
}
