import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ManualVerifyPaymentInput,
  PaymentStatusContract,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { withRequestOptions } from "@/core/api/request-context";
import { newIdempotencyKey } from "@/core/ids";
import { enqueue } from "@/core/offline/queue";
import { authState } from "@/core/auth/auth-state";
import { env } from "@/core/env";
import { isApiError, normalizeHttpError } from "@/core/errors";
import { creditKeys } from "@/features/credit/api/queries";

const PAGE_SIZE = 20;

/** `kind` de la cola offline para abonos en efectivo. */
export const CASH_PAYMENT_KIND = "cash-payment";

export type CashPaymentPayload = { creditId: string; amountMinor: number };

export const paymentKeys = {
  all: ["payments"] as const,
  list: (creditId: string) => [...paymentKeys.all, "list", creditId] as const,
  attempts: (params: PaymentAttemptsParams) =>
    [...paymentKeys.all, "attempts", params] as const,
  detail: (id: string) => [...paymentKeys.all, "detail", id] as const,
};

export interface PaymentAttemptsParams {
  status?: PaymentStatusContract;
  failedOnly?: boolean;
}

/** Intentos de pago a nivel tenant (auditoría), filtrables por estado. Reviewer-only en el server. */
export function usePaymentAttempts(params: PaymentAttemptsParams = {}) {
  return useInfiniteQuery({
    queryKey: paymentKeys.attempts(params),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listPaymentAttempts({
          headers: tenantHeader(),
          query: {
            page: pageParam,
            pageSize: PAGE_SIZE,
            ...(params.status ? { status: params.status } : {}),
            ...(params.failedOnly ? { failedOnly: true } : {}),
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Detalle completo de un intento de pago (metadata IA + banco + proceso). */
export function usePaymentDetail(id: string) {
  return useQuery({
    queryKey: paymentKeys.detail(id),
    queryFn: async () =>
      unwrap(await api.getPaymentDetail({ headers: tenantHeader(), params: { paymentId: id } })),
  });
}

/** Validación manual del pago (motivo obligatorio): hace efectivo el abono. */
export function useManualVerifyPayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ManualVerifyPaymentInput) =>
      unwrap(
        await api.manualVerifyPayment({
          headers: tenantHeader(),
          params: { paymentId: id },
          body: input,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentKeys.all });
    },
  });
}

/**
 * Descarga el comprobante (binario) como objectURL para mostrarlo con zoom. El cliente ts-rest no
 * maneja binario: fetch autenticado directo reusando el snapshot de sesión. El backend responde
 * `no-store` (PII/evidencia, no se cachea).
 */
export async function fetchPaymentReceiptUrl(
  paymentId: string,
): Promise<{ url: string; mimeType: string }> {
  const token = authState.getAccessToken();
  const tenantId = authState.getTenantId();
  if (!token || !tenantId) throw normalizeHttpError(401, { message: "Sesión sin tenant" });

  const res = await fetch(`${env.apiUrl}/payments/${paymentId}/receipt`, {
    headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
  });
  if (!res.ok) throw normalizeHttpError(res.status, { message: "No se pudo abrir el comprobante" });
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mimeType: res.headers.get("Content-Type") ?? blob.type };
}

/** Comprobante como objectURL, listo para el visor con zoom. Solo cuando hay un id seleccionado. */
export function usePaymentReceipt(paymentId: string | null) {
  return useQuery({
    queryKey: [...paymentKeys.all, "receipt", paymentId],
    enabled: paymentId != null,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async () => fetchPaymentReceiptUrl(paymentId as string),
  });
}

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
