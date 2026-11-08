import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BorrowerSummary,
  CreateBorrowerInput,
  UpdateBorrowerInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export interface BorrowersListParams {
  page?: number;
  /** Búsqueda unificada en servidor: nombre, cédula o teléfono (OR). */
  q?: string;
  name?: string;
  withoutCredits?: boolean;
}

export const borrowerKeys = {
  all: ["borrowers"] as const,
  list: (params: BorrowersListParams) => [...borrowerKeys.all, "list", params] as const,
  infinite: (params: BorrowersListParams) => [...borrowerKeys.all, "infinite", params] as const,
};

const PAGE_SIZE = 20;

/** Parámetros de consulta de una página del listado (comparten los filtros ambos hooks). */
function listQuery(params: BorrowersListParams, page: number) {
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(params.q ? { q: params.q } : {}),
    ...(params.name ? { name: params.name } : {}),
    ...(params.withoutCredits ? { withoutCredits: true } : {}),
  };
}

/** Una página de clientes del tenant (búsqueda `q` o `name`, filtro "sin créditos"). */
export function useBorrowersList(params: BorrowersListParams = {}) {
  return useQuery({
    queryKey: borrowerKeys.list(params),
    queryFn: async () =>
      unwrap(
        await api.listBorrowers({
          headers: tenantHeader(),
          query: listQuery(params, params.page ?? 1),
        }),
      ),
  });
}

/**
 * Listado INFINITO de clientes con búsqueda unificada `q` (nombre, cédula o teléfono) en servidor.
 * El total viene en cada página (`total`) para decir "N clientes" / "Mostrando N de M".
 */
export function useBorrowersInfinite(params: Omit<BorrowersListParams, "page"> = {}) {
  return useInfiniteQuery({
    queryKey: borrowerKeys.infinite(params),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listBorrowers({ headers: tenantHeader(), query: listQuery(params, pageParam) })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

// Normaliza la cédula igual que el dominio (`normalizeNationalId`): recorta extremos y colapsa
// espacios internos. Se duplica aquí porque el móvil solo depende de `contracts`, no de `domain`.
function normalizeNationalId(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Busca el cliente cuya cédula coincide EXACTAMENTE con la dada, dentro del tenant. Sostiene la
 * idempotencia del alta desde OCR: si la cédula ya existe (el alta chocaría por unicidad), permite
 * reusar ese cliente en vez de dejar el flujo en un callejón sin salida. `null` si no hay match.
 */
export async function findBorrowerByNationalId(
  nationalId: string,
): Promise<BorrowerSummary | null> {
  const trimmed = nationalId.trim();
  if (!trimmed) return null;
  // El filtro del listado es por subcadena (ilike); afinamos a coincidencia exacta normalizada.
  const { items } = unwrap(
    await api.listBorrowers({
      headers: tenantHeader(),
      query: { page: 1, pageSize: PAGE_SIZE, nationalId: trimmed },
    }),
  );
  const target = normalizeNationalId(trimmed);
  return items.find((b) => normalizeNationalId(b.nationalId) === target) ?? null;
}

export function useCreateBorrower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBorrowerInput) =>
      unwrap(await api.createBorrower({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: borrowerKeys.all }),
  });
}

export function useUpdateBorrower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: UpdateBorrowerInput }) =>
      unwrap(
        await api.updateBorrower({
          headers: tenantHeader(),
          params: { id: input.id },
          body: input.patch,
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: borrowerKeys.all }),
  });
}
