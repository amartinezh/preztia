import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateTenantInput,
  TenantStatus,
  UpdateTenantAdminInput,
} from "@preztiaos/contracts";

import { api, unwrap } from "@/core/api/client";

// Plano de control (super admin): los endpoints de tenants NO llevan `x-tenant-id`; el
// fetcher inyecta el `Authorization: Bearer` y el backend valida con el SuperAdminGuard.

const PAGE_SIZE = 20;

export const tenantKeys = {
  all: ["tenants"] as const,
  list: () => [...tenantKeys.all, "list"] as const,
  admins: (tenantId: string) => [...tenantKeys.all, "admins", tenantId] as const,
};

export function useTenantsList() {
  return useInfiniteQuery({
    queryKey: tenantKeys.list(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listTenants({ query: { page: pageParam, pageSize: PAGE_SIZE } })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTenantInput) =>
      unwrap(await api.createTenant({ body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantKeys.list() }),
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status?: TenantStatus; name?: string }) =>
      unwrap(
        await api.updateTenant({
          params: { id: input.id },
          body: {
            ...(input.status ? { status: input.status } : {}),
            ...(input.name ? { name: input.name } : {}),
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantKeys.list() }),
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.deleteTenant({ params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantKeys.list() }),
  });
}

export function useTenantAdminsList(tenantId: string) {
  return useInfiniteQuery({
    queryKey: tenantKeys.admins(tenantId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listTenantAdmins({
          params: { id: tenantId },
          query: { page: pageParam, pageSize: PAGE_SIZE },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useCreateTenantAdmin(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) =>
      unwrap(await api.createTenantAdmin({ params: { id: tenantId }, body: input })),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: tenantKeys.admins(tenantId) }),
  });
}

export function useUpdateTenantAdmin(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { adminId: string } & UpdateTenantAdminInput) =>
      unwrap(
        await api.updateTenantAdmin({
          params: { id: tenantId, adminId: input.adminId },
          body: {
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.password !== undefined ? { password: input.password } : {}),
          },
        }),
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: tenantKeys.admins(tenantId) }),
  });
}
