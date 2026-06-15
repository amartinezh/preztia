import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { CreateUserInput, UserSummary } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

const PAGE_SIZE = 20;

export const userKeys = {
  all: ["users"] as const,
  list: (role?: string) => [...userKeys.all, "list", role ?? "all"] as const,
};

/** Lista paginada de usuarios del tenant, opcionalmente filtrada por rol. */
export function useUsersList(role?: UserSummary["role"]) {
  return useInfiniteQuery({
    queryKey: userKeys.list(role),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listUsers({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE, ...(role ? { role } : {}) },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) =>
      unwrap(await api.createUser({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; active?: boolean; zonePaths?: string[] }) =>
      unwrap(
        await api.updateUser({
          headers: tenantHeader(),
          params: { id: input.id },
          body: {
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.zonePaths !== undefined ? { zonePaths: input.zonePaths } : {}),
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}
