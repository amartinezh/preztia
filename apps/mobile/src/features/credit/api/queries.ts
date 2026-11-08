import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrantCreditInput, QuoteCreditInput, RegisterMigratedCreditInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { withRequestOptions } from "@/core/api/request-context";
import { useDebouncedValue } from "@/core/hooks/use-debounced-value";
import { cashBoxKeys } from "@/features/cash/api/boxes-queries";

const PAGE_SIZE = 20;

export const creditKeys = {
  all: ["credits"] as const,
  list: () => [...creditKeys.all, "list"] as const,
  // Lo conservan los hooks de pagos para invalidar el saldo del crédito tras un abono.
  portfolio: (creditId: string) => [...creditKeys.all, "portfolio", creditId] as const,
  quote: (serialized: string) => [...creditKeys.all, "quote", serialized] as const,
};

/**
 * Carga un crédito del sistema anterior con sus abonos históricos (ADMIN). No mueve cajas. La
 * clave de idempotencia la fija la pantalla por intento de formulario: un reintento tras perder la
 * respuesta devuelve el mismo crédito en vez de registrar otro (§3.7).
 */
export function useRegisterMigratedCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...input }: RegisterMigratedCreditInput & { idempotencyKey: string }) =>
      unwrap(
        await withRequestOptions({ idempotencyKey }, () =>
          api.registerMigratedCredit({ headers: tenantHeader(), body: input }),
        ),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: creditKeys.all }),
  });
}

/** Lista paginada de créditos (paginación obligatoria, §3.7). */
export function useCreditsList() {
  return useInfiniteQuery({
    queryKey: creditKeys.list(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listCredits({ headers: tenantHeader(), query: { page: pageParam, pageSize: PAGE_SIZE } })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/**
 * Cotización EN VIVO del cronograma (cuota, total, fechas) mientras se capturan los términos. Es la
 * regla pura del servidor (`buildSchedule`): no persiste nada. `null` = términos aún incompletos (no
 * consulta). Retardo de 300 ms para no pedir una cotización por pulsación, y conserva la anterior
 * mientras llega la nueva para que la tarjeta no parpadee.
 */
export function useCreditQuote(input: QuoteCreditInput | null) {
  // Se retarda la forma serializada: el objeto cambia de identidad en cada render.
  const serialized = useDebouncedValue(input ? JSON.stringify(input) : null);
  return useQuery({
    queryKey: creditKeys.quote(serialized ?? ""),
    enabled: serialized !== null,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.quoteCredit({
          headers: tenantHeader(),
          body: JSON.parse(serialized as string) as QuoteCreditInput,
        }),
      ),
  });
}

/**
 * Otorga un crédito (desembolso: operación de dinero). La clave de idempotencia es estable por
 * intento de formulario, así un reintento manual tras un timeout no desembolsa dos veces.
 */
export function useGrantCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...input }: GrantCreditInput & { idempotencyKey: string }) =>
      unwrap(
        await withRequestOptions({ idempotencyKey }, () =>
          api.grantCredit({ headers: tenantHeader(), body: input }),
        ),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creditKeys.list() });
      // Otorgar desembolsa: el saldo de la caja de origen bajó.
      void qc.invalidateQueries({ queryKey: cashBoxKeys.all });
    },
  });
}
