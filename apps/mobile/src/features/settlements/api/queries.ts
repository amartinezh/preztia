import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { authState } from "@/core/auth/auth-state";
import { env } from "@/core/env";
import { normalizeHttpError } from "@/core/errors";
import { transactionQuery, type TransactionFilters } from "@/features/cash/api/boxes-queries";

// Períodos del histórico que se comparan en la tabla y la gráfica de tendencia.
export const HISTORY_PERIODS = 12;

export const settlementKeys = {
  all: ["settlements"] as const,
  current: () => [...settlementKeys.all, "current"] as const,
  list: () => [...settlementKeys.all, "list"] as const,
  detail: (id: string) => [...settlementKeys.all, "detail", id] as const,
};

/** Liquidación en curso (en vivo desde la última liquidación). */
export function useCurrentSettlement() {
  return useQuery({
    queryKey: settlementKeys.current(),
    queryFn: async () => unwrap(await api.getCurrentSettlement({ headers: tenantHeader() })),
  });
}

/** Histórico de liquidaciones cerradas (más recientes primero). */
export function useSettlements() {
  return useInfiniteQuery({
    queryKey: settlementKeys.list(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listSettlements({ headers: tenantHeader(), query: { page: pageParam, pageSize: HISTORY_PERIODS } }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useSettlement(id: string | null) {
  return useQuery({
    queryKey: settlementKeys.detail(id ?? ""),
    enabled: !!id,
    queryFn: async () => unwrap(await api.getSettlement({ headers: tenantHeader(), params: { id: id! } })),
  });
}

/** Cierra el siguiente período terminado (solo ADMIN). */
export function useCloseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.closeSettlement({ headers: tenantHeader(), body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: settlementKeys.all }),
  });
}

/**
 * CSV del libro con los filtros dados (detalle de una liquidación). Fetch autenticado directo: el
 * cliente ts-rest no maneja texto plano. Devuelve el contenido y si el servidor lo recortó.
 */
export async function fetchLedgerCsv(filters: TransactionFilters): Promise<{ csv: string; truncated: boolean }> {
  const token = authState.getAccessToken();
  const tenantId = authState.getTenantId();
  if (!token || !tenantId) throw normalizeHttpError(401, { message: "Sesión sin tenant" });
  const query = new URLSearchParams(transactionQuery(filters)).toString();
  const res = await fetch(`${env.apiUrl}/cash/transactions/export?${query}`, {
    headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
  });
  if (!res.ok) throw normalizeHttpError(res.status, { message: "No se pudo exportar" });
  return { csv: await res.text(), truncated: res.headers.get("X-Export-Truncated") === "true" };
}
