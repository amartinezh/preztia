import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const listKeys = {
  all: ["borrower-lists"] as const,
  lists: () => [...listKeys.all, "lists"] as const,
};

export function useBorrowerLists() {
  return useQuery({
    queryKey: listKeys.lists(),
    queryFn: async () => unwrap(await api.listBorrowerLists({ headers: tenantHeader() })),
  });
}

export function useCreateBorrowerList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await api.createBorrowerList({ headers: tenantHeader(), body: { name } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: listKeys.all }),
  });
}

export function useDeleteBorrowerList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.deleteBorrowerList({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: listKeys.all }),
  });
}

export function useAddListMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listId: string; borrowerIds: string[] }) =>
      unwrap(
        await api.addListMembers({
          headers: tenantHeader(),
          params: { id: input.listId },
          body: { borrowerIds: input.borrowerIds },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: listKeys.all }),
  });
}
