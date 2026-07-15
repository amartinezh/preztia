import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BorrowerSummary,
  CreateBorrowerInput,
  UpdateBorrowerInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export interface BorrowersListParams {
  page?: number;
  name?: string;
  withoutCredits?: boolean;
}

export const borrowerKeys = {
  all: ["borrowers"] as const,
  list: (params: BorrowersListParams) => [...borrowerKeys.all, "list", params] as const,
};

const PAGE_SIZE = 20;

/** Lista paginada de clientes del tenant, con filtros de nombre y "sin créditos". */
export function useBorrowersList(params: BorrowersListParams = {}) {
  return useQuery({
    queryKey: borrowerKeys.list(params),
    queryFn: async () =>
      unwrap(
        await api.listBorrowers({
          headers: tenantHeader(),
          query: {
            page: params.page ?? 1,
            pageSize: PAGE_SIZE,
            ...(params.name ? { name: params.name } : {}),
            ...(params.withoutCredits ? { withoutCredits: true } : {}),
          },
        }),
      ),
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
