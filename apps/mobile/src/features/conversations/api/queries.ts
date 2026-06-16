import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";

const PAGE_SIZE = 20;

export interface InboxFilters {
  search?: string;
  withApplication?: boolean;
}

export const inboxKeys = {
  all: ["conversations"] as const,
  list: (f: InboxFilters) => [...inboxKeys.all, "list", f] as const,
  thread: (phone: string) => [...inboxKeys.all, "thread", phone] as const,
};

/** Bandeja de WhatsApp: conversaciones agrupadas por cliente, scopeadas por zona. */
export function useConversationsList(filters: InboxFilters = {}) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listConversations({
          headers: tenantHeader(),
          query: {
            page: pageParam,
            pageSize: PAGE_SIZE,
            ...(filters.search ? { search: filters.search } : {}),
            ...(filters.withApplication ? { withApplication: true } : {}),
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Hilo completo de mensajes con un cliente (lazy: solo al abrir). */
export function useConversationThread(phone: string | null) {
  return useQuery({
    queryKey: inboxKeys.thread(phone ?? "none"),
    enabled: phone !== null,
    queryFn: async () =>
      unwrap(
        await api.getConversationThread({ headers: tenantHeader(), query: { phone: phone as string } }),
      ),
  });
}
