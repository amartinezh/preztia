import { useQuery } from "@tanstack/react-query";
import type { BorrowerSummary } from "@preztiaos/contracts";

import { borrowerKeys, findBorrowerByNationalId } from "@/features/borrowers/api/queries";

/**
 * Resuelve el cliente que la pantalla de Clientes pasó por la URL ("Nuevo crédito" prellenado):
 * `borrowerId` es la identidad y `nationalId` la pista de búsqueda, porque el API no expone
 * `GET /borrowers/:id`. Se localiza por cédula exacta y se COMPRUEBA el id: una pista que no
 * corresponda al id no se preselecciona (nunca se otorga al cliente equivocado). `null` = no hallado.
 */
export function usePrefilledBorrower(borrowerId: string | undefined, nationalId: string | undefined) {
  return useQuery({
    queryKey: [...borrowerKeys.all, "prefill", borrowerId ?? "", nationalId ?? ""] as const,
    enabled: !!borrowerId,
    queryFn: async (): Promise<BorrowerSummary | null> => {
      if (!borrowerId || !nationalId) return null;
      const found = await findBorrowerByNationalId(nationalId);
      return found !== null && found.id === borrowerId ? found : null;
    },
  });
}
