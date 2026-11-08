import { useQuery } from "@tanstack/react-query";
import type { BorrowerSummary } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { borrowerKeys } from "@/features/borrowers/api/queries";

/**
 * Resuelve el cliente que la pantalla de Clientes pasó por la URL ("Nuevo crédito" prellenado) con
 * su ficha real (`GET /borrowers/:id`): nunca se otorga al cliente equivocado. `null` = no existe.
 */
export function usePrefilledBorrower(borrowerId: string | undefined) {
  return useQuery({
    queryKey: [...borrowerKeys.all, "detail", borrowerId ?? ""] as const,
    enabled: !!borrowerId,
    queryFn: async (): Promise<BorrowerSummary | null> => {
      if (!borrowerId) return null;
      return unwrap(await api.getBorrower({ headers: tenantHeader(), params: { id: borrowerId } }));
    },
  });
}
