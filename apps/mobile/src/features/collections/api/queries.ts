import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { inboxKeys } from "@/features/conversations/api/queries";

export const collectionKeys = {
  all: ["collections"] as const,
  panel: (creditId: string) => [...collectionKeys.all, "panel", creditId] as const,
};

/** Panel de cobranza de un crédito: cuota de hoy, teléfono y estado PIX. */
export function useCreditCollection(creditId: string) {
  return useQuery({
    queryKey: collectionKeys.panel(creditId),
    queryFn: async () =>
      unwrap(await api.getCreditCollection({ headers: tenantHeader(), params: { creditId } })),
  });
}

/**
 * Envío MANUAL del recordatorio de cobro por WhatsApp. Al terminar refresca el panel y, si se
 * envió, el hilo de la conversación (el mensaje saliente ya quedó en el transcript).
 */
export function useSendCollectionReminder(creditId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.sendCollectionReminder({
          headers: tenantHeader(),
          params: { creditId },
          body: {},
        }),
      ),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: collectionKeys.panel(creditId) });
      if (result.sent && result.phone) {
        void qc.invalidateQueries({ queryKey: inboxKeys.thread(result.phone) });
      }
    },
  });
}
