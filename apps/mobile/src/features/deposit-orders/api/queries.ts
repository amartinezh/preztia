import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEPOSIT_RECEIPT_FIELD,
  type FieldOrderStatus,
  type IssueDepositOrderInput,
  type VerifyDepositInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { appendPickedFile, type PickedFile } from "@/core/api/multipart";
import { cashBoxKeys } from "@/features/cash/api/boxes-queries";
import { remittanceKeys } from "@/features/remittances/api/queries";

const PAGE_SIZE = 20;

export const depositOrderKeys = {
  all: ["deposit-orders"] as const,
  list: (scope: "mine" | "review", status?: FieldOrderStatus) =>
    [...depositOrderKeys.all, scope, status ?? "all"] as const,
  events: (id: string) => [...depositOrderKeys.all, "events", id] as const,
  matches: (id: string) => [...depositOrderKeys.all, "matches", id] as const,
};

/** Órdenes del alcance: las propias del cobrador (`mine`) o las de la zona del revisor (`review`). */
export function useDepositOrders(scope: "mine" | "review", status?: FieldOrderStatus) {
  return useInfiniteQuery({
    queryKey: depositOrderKeys.list(scope, status),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const query = { page: pageParam, pageSize: PAGE_SIZE, ...(status ? { status } : {}) };
      return unwrap(
        scope === "mine"
          ? await api.listMyDepositOrders({ headers: tenantHeader(), query })
          : await api.listDepositOrders({ headers: tenantHeader(), query }),
      );
    },
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useDepositOrderEvents(orderId: string | null) {
  return useQuery({
    queryKey: depositOrderKeys.events(orderId ?? ""),
    enabled: orderId != null,
    queryFn: async () =>
      unwrap(await api.listDepositOrderEvents({ headers: tenantHeader(), params: { id: orderId! } })),
  });
}

export function useDepositBankMatches(orderId: string) {
  return useQuery({
    queryKey: depositOrderKeys.matches(orderId),
    queryFn: async () =>
      unwrap(await api.listDepositBankMatches({ headers: tenantHeader(), params: { id: orderId } })),
  });
}

/** Invalida órdenes y, cuando se movió dinero, cajas y rendiciones. */
function useInvalidate(moneyMoved: boolean) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: depositOrderKeys.all });
    if (moneyMoved) {
      void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
      void qc.invalidateQueries({ queryKey: remittanceKeys.all });
    }
  };
}

export function useIssueDepositOrder() {
  const invalidate = useInvalidate(false);
  return useMutation({
    mutationFn: async (body: IssueDepositOrderInput) =>
      unwrap(await api.issueDepositOrder({ headers: tenantHeader(), body })),
    onSuccess: invalidate,
  });
}

export function useMarkDepositOrderSeen() {
  const invalidate = useInvalidate(false);
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.markDepositOrderSeen({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: invalidate,
  });
}

export function useReportDeposit() {
  const invalidate = useInvalidate(false);
  return useMutation({
    mutationFn: async (input: {
      id: string;
      amountMinor: number;
      depositedAt: string;
      reference?: string;
      note?: string;
      receipt: PickedFile;
    }) => {
      const form = new FormData();
      form.append("amountMinor", String(input.amountMinor));
      form.append("depositedAt", input.depositedAt);
      if (input.reference) form.append("reference", input.reference);
      if (input.note) form.append("note", input.note);
      await appendPickedFile(form, DEPOSIT_RECEIPT_FIELD, input.receipt);
      return unwrap(
        await api.reportDeposit({ headers: tenantHeader(), params: { id: input.id }, body: form }),
      );
    },
    onSuccess: invalidate,
  });
}

export function useVerifyDeposit() {
  const invalidate = useInvalidate(true);
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & VerifyDepositInput) =>
      unwrap(await api.verifyDeposit({ headers: tenantHeader(), params: { id }, body })),
    onSuccess: invalidate,
  });
}

/** Objetar o cancelar (ambos con motivo). */
export function useCloseDepositOrder() {
  const invalidate = useInvalidate(false);
  return useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: "dispute" | "cancel"; reason: string }) =>
      unwrap(
        action === "dispute"
          ? await api.disputeDeposit({ headers: tenantHeader(), params: { id }, body: { reason } })
          : await api.cancelDepositOrder({ headers: tenantHeader(), params: { id }, body: { reason } }),
      ),
    onSuccess: invalidate,
  });
}

export function useCommentDepositOrder() {
  const invalidate = useInvalidate(false);
  return useMutation({
    mutationFn: async ({ id, message }: { id: string; message: string }) =>
      unwrap(
        await api.commentDepositOrder({ headers: tenantHeader(), params: { id }, body: { message } }),
      ),
    onSuccess: invalidate,
  });
}
