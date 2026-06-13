import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { withRequestOptions } from "@/core/api/request-context";
import { newIdempotencyKey } from "@/core/ids";
import { enqueue } from "@/core/offline/queue";
import { isApiError } from "@/core/errors";
import { creditKeys } from "@/features/credit/api/queries";

const PAGE_SIZE = 20;

/** `kind` de la cola offline para abonos en efectivo. */
export const CASH_PAYMENT_KIND = "cash-payment";

export type CashPaymentPayload = { creditId: string; amountMinor: number };

export const paymentKeys = {
  all: ["payments"] as const,
  list: (creditId: string) => [...paymentKeys.all, "list", creditId] as const,
};

/** Pagos de un crédito (paginado, PII enmascarada en el contrato). */
export function usePaymentsList(creditId: string) {
  return useInfiniteQuery({
    queryKey: paymentKeys.list(creditId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listCreditPayments({
          headers: tenantHeader(),
          params: { creditId },
          query: { page: pageParam, pageSize: PAGE_SIZE },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export type RegisterResult =
  | { queued: false; balanceMinor: number }
  | { queued: true };

/**
 * Registra un abono en efectivo de forma IDEMPOTENTE.
 *
 * - Genera UNA `Idempotency-Key` por operación; se reutiliza en cada reenvío.
 * - Si falla por red (offline/timeout), encola la operación con la MISMA clave para
 *   reintentarla al recuperar conexión: sin doble abono (§3.7 confiabilidad).
 * - React Query no reintenta mutaciones (el reintento seguro lo gobierna el transporte/cola).
 */
export function useRegisterCashPayment() {
  const qc = useQueryClient();
  return useMutation<RegisterResult, unknown, CashPaymentPayload>({
    mutationFn: async ({ creditId, amountMinor }) => {
      const idempotencyKey = newIdempotencyKey();
      try {
        const result = unwrap(
          await withRequestOptions({ idempotencyKey }, () =>
            api.registerCashPayment({
              headers: tenantHeader(),
              params: { creditId },
              body: { amountMinor },
            }),
          ),
        );
        return { queued: false, balanceMinor: result.balanceMinor };
      } catch (err) {
        // Sin conexión: persistir para reenvío con la misma clave (idempotente).
        if (isApiError(err) && err.status === 0) {
          await enqueue(CASH_PAYMENT_KIND, { creditId, amountMinor }, idempotencyKey);
          return { queued: true };
        }
        throw err;
      }
    },
    onSuccess: (_res, { creditId }) => {
      void qc.invalidateQueries({ queryKey: paymentKeys.list(creditId) });
      void qc.invalidateQueries({ queryKey: creditKeys.portfolio(creditId) });
    },
  });
}

/** Conciliación bancaria (operación de dinero idempotente). */
export function useReconcilePayments() {
  return useMutation({
    mutationFn: async () => {
      const idempotencyKey = newIdempotencyKey();
      return unwrap(
        await withRequestOptions({ idempotencyKey }, () =>
          api.reconcilePayments({ headers: tenantHeader(), body: {} }),
        ),
      );
    },
  });
}
