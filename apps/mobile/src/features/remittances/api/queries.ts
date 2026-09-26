import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloseDebtInput,
  ReceiveRemittanceInput,
  SubmitRemittanceInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { cashBoxKeys } from "@/features/cash/api/boxes-queries";

const PAGE_SIZE = 20;

export const remittanceKeys = {
  all: ["remittances"] as const,
  mine: () => [...remittanceKeys.all, "mine"] as const,
  myHistory: () => [...remittanceKeys.all, "my-history"] as const,
  board: (withDebt: boolean) => [...remittanceKeys.all, "board", withDebt] as const,
  history: (collectorId: string | null) => [...remittanceKeys.all, "history", collectorId] as const,
};

/** Estado de la rendición del cobrador autenticado (efectivo, deuda, período y atraso). */
export function useMyRemittance() {
  return useQuery({
    queryKey: remittanceKeys.mine(),
    queryFn: async () => unwrap(await api.getMyRemittance({ headers: tenantHeader() })),
  });
}

/** Historial propio del cobrador (paginado). */
export function useMyRemittanceHistory() {
  return useInfiniteQuery({
    queryKey: remittanceKeys.myHistory(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listMyRemittances({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useSubmitRemittance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SubmitRemittanceInput) =>
      unwrap(await api.submitMyRemittance({ headers: tenantHeader(), body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: remittanceKeys.all }),
  });
}

/** Tablero del coordinador: una fila por cobrador con caja de ruta (paginado). */
export function useRemittanceBoard(withDebt: boolean) {
  return useInfiniteQuery({
    queryKey: remittanceKeys.board(withDebt),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.getRemittanceBoard({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE, withDebt: withDebt ? "true" : "false" },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Historial de rendiciones del alcance (opcionalmente de un cobrador). */
export function useRemittanceHistory(collectorId: string | null) {
  return useInfiniteQuery({
    queryKey: remittanceKeys.history(collectorId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listRemittances({
          headers: tenantHeader(),
          query: {
            page: pageParam,
            pageSize: PAGE_SIZE,
            ...(collectorId ? { collectorId } : {}),
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Recepción: mueve dinero en el libro, así que también cambian los saldos de las cajas. */
export function useReceiveRemittance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & ReceiveRemittanceInput) => {
      const { id, ...body } = input;
      return unwrap(await api.receiveRemittance({ headers: tenantHeader(), params: { id }, body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: remittanceKeys.all });
      void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
    },
  });
}

export function useCloseDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { collectorId: string } & CloseDebtInput) => {
      const { collectorId, ...body } = input;
      return unwrap(
        await api.closeCollectorDebt({ headers: tenantHeader(), params: { id: collectorId }, body }),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: remittanceKeys.all });
      void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
    },
  });
}
