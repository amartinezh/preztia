import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ConversationFilters,
  ConversationOrder,
  ConversationSort,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

const PAGE_SIZE = 20;

export type InboxFilters = ConversationFilters;
export type InboxSort = { sort: ConversationSort; order: ConversationOrder };

export const inboxKeys = {
  all: ["conversations"] as const,
  list: (f: InboxFilters, s: InboxSort) => [...inboxKeys.all, "list", f, s] as const,
  stats: (f: InboxFilters) => [...inboxKeys.all, "stats", f] as const,
  thread: (phone: string) => [...inboxKeys.all, "thread", phone] as const,
};

/**
 * La estadística responde a los mismos filtros MENOS el desenlace: los contadores muestran el
 * desglose completo del rango consultado aunque el operador esté viendo una sola categoría.
 */
function withoutOutcome(filters: InboxFilters): Omit<InboxFilters, "outcome"> {
  const { outcome: _outcome, ...rest } = filters;
  return rest;
}

/** Bandeja de WhatsApp: conversaciones agrupadas por cliente, scopeadas por zona. */
export function useConversationsList(filters: InboxFilters, sorting: InboxSort) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(filters, sorting),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listConversations({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE, ...filters, ...sorting },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Estadística de la cola por desenlace (tarjetas de la cabecera). */
export function useConversationStats(filters: InboxFilters) {
  return useQuery({
    queryKey: inboxKeys.stats(filters),
    queryFn: async () =>
      unwrap(
        await api.conversationStats({
          headers: tenantHeader(),
          query: withoutOutcome(filters),
        }),
      ),
  });
}

/** Hilo completo de mensajes y fallos con un cliente (lazy: solo al abrir). */
export function useConversationThread(phone: string | null) {
  return useQuery({
    queryKey: inboxKeys.thread(phone ?? "none"),
    enabled: phone !== null,
    queryFn: async () =>
      unwrap(
        await api.getConversationThread({
          headers: tenantHeader(),
          query: { phone: phone as string },
        }),
      ),
  });
}

/** Borra las conversaciones seleccionadas (una o un lote). */
export function useDeleteConversations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (phones: string[]) =>
      unwrap(
        await api.deleteConversations({ headers: tenantHeader(), body: { phones } }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

/** Limpia todas las conversaciones que casan con los filtros aplicados. */
export function usePurgeConversations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (filters: InboxFilters) =>
      unwrap(
        await api.purgeConversations({
          headers: tenantHeader(),
          body: { ...filters, confirm: true },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}
