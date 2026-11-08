import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UpdateCollectorClientsInput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { clientKeys } from "@/features/clients/api/queries";

/**
 * Ajusta la cartera del cobrador por DELTAS: solo lo que la persona marcó (`add`) o desmarcó
 * (`remove`); el resto de la cartera no se toca. Así guardar no depende de haber cargado todas
 * las páginas (reemplazar con lo cargado desasignaba en silencio). Devuelve el total asignado.
 */
export function useUpdateCollectorClients(collectorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateCollectorClientsInput) =>
      unwrap(
        await api.updateClients({
          headers: tenantHeader(),
          params: { id: collectorId },
          body: input,
        }),
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: clientKeys.assignable(collectorId) }),
  });
}
