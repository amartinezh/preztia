import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApproveApplicationInput,
  CreditApplicationStatus,
  OfferPlansInput,
  RejectApplicationInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { authState } from "@/core/auth/auth-state";
import { env } from "@/core/env";
import { normalizeHttpError } from "@/core/errors";

const PAGE_SIZE = 20;

export const reviewKeys = {
  all: ["applications-review"] as const,
  list: (status?: CreditApplicationStatus) => [...reviewKeys.all, "list", status ?? "all"] as const,
  detail: (id: string) => [...reviewKeys.all, "detail", id] as const,
  conversation: (id: string) => [...reviewKeys.all, "conversation", id] as const,
  rejections: () => [...reviewKeys.all, "rejections"] as const,
};

/** Lista paginada de intentos de solicitud con su veredicto (filtrable por estado). */
export function useApplicationsList(status?: CreditApplicationStatus) {
  return useInfiniteQuery({
    queryKey: reviewKeys.list(status),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.listApplications({
          headers: tenantHeader(),
          query: { page: pageParam, pageSize: PAGE_SIZE, ...(status ? { status } : {}) },
        }),
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Histórico de rechazos (motivo + quién + cuándo), scopeado por zona. */
export function useRejections() {
  return useInfiniteQuery({
    queryKey: reviewKeys.rejections(),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.listRejections({ headers: tenantHeader(), query: { page: pageParam, pageSize: PAGE_SIZE } })),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/** Detalle completo de un expediente: documentos + historial antifraude. */
export function useApplicationReview(id: string) {
  return useQuery({
    queryKey: reviewKeys.detail(id),
    queryFn: async () => unwrap(await api.getApplicationReview({ headers: tenantHeader(), params: { id } })),
  });
}

/** Transcript de la conversación con el cliente (lazy: solo al abrir el panel). */
export function useApplicationConversation(id: string, enabled: boolean) {
  return useQuery({
    queryKey: reviewKeys.conversation(id),
    enabled,
    queryFn: async () => unwrap(await api.getApplicationConversation({ headers: tenantHeader(), params: { id } })),
  });
}

/** Aprueba el expediente y genera el crédito. Refresca lista y detalle. */
export function useApproveApplication(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveApplicationInput) =>
      unwrap(await api.approveApplication({ headers: tenantHeader(), params: { id }, body: input })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.all });
      void qc.invalidateQueries({ queryKey: reviewKeys.detail(id) });
    },
  });
}

/** Oferta planes al cliente por WhatsApp (botón azul). Refresca el detalle (cambia el sub-estado). */
export function useOfferPlans(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OfferPlansInput) =>
      unwrap(await api.offerPlans({ headers: tenantHeader(), params: { id }, body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reviewKeys.detail(id) }),
  });
}

/** Rechaza el expediente. Refresca lista y detalle. */
export function useRejectApplication(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RejectApplicationInput) =>
      unwrap(await api.rejectApplication({ headers: tenantHeader(), params: { id }, body: input })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.all });
      void qc.invalidateQueries({ queryKey: reviewKeys.detail(id) });
    },
  });
}

/**
 * Documento original (binario) como objectURL, listo para mostrar. Se ejecuta solo cuando hay
 * un documento seleccionado (al abrir el visor). No se cachea (`gcTime: 0`): el binario es PII
 * y se descarta al cerrar; el componente revoca el objectURL.
 */
export function useDocumentOriginal(applicationId: string, documentType: string | null) {
  return useQuery({
    queryKey: [...reviewKeys.detail(applicationId), "original", documentType],
    enabled: documentType != null,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async () =>
      fetchDocumentOriginalUrl({ applicationId, documentType: documentType as string }),
  });
}

/**
 * Descarga el documento original (binario) como objectURL para mostrarlo. El cliente ts-rest
 * no maneja binario, así que se hace un fetch autenticado directo reusando el token/tenant del
 * snapshot de sesión. El binario es PII: el backend responde `no-store` (no se cachea).
 */
export async function fetchDocumentOriginalUrl(input: {
  applicationId: string;
  documentType: string;
}): Promise<{ url: string; mimeType: string }> {
  const token = authState.getAccessToken();
  const tenantId = authState.getTenantId();
  if (!token || !tenantId) throw normalizeHttpError(401, { message: "Sesión sin tenant" });

  const res = await fetch(
    `${env.apiUrl}/applications/${input.applicationId}/documents/${input.documentType}/original`,
    { headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId } },
  );
  if (!res.ok) {
    throw normalizeHttpError(res.status, { message: "No se pudo abrir el documento" });
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mimeType: res.headers.get("Content-Type") ?? blob.type };
}
