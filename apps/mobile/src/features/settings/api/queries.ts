import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SetDocumentRequirementsInput,
  UpdateAssistantConfigInput,
  UpdateOperationalSettingsInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const settingsKeys = {
  all: ["tenant-config"] as const,
  operational: () => [...settingsKeys.all, "operational"] as const,
  assistant: () => [...settingsKeys.all, "assistant"] as const,
  documents: () => [...settingsKeys.all, "documents"] as const,
};

export function useOperationalSettings() {
  return useQuery({
    queryKey: settingsKeys.operational(),
    queryFn: async () =>
      unwrap(await api.getOperationalSettings({ headers: tenantHeader() })),
  });
}

export function useUpdateOperationalSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateOperationalSettingsInput) =>
      unwrap(await api.updateOperationalSettings({ headers: tenantHeader(), body: patch })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

// ── Asistente de WhatsApp (base de conocimiento + IA), ADMIN ────────────────
export function useAssistantConfig() {
  return useQuery({
    queryKey: settingsKeys.assistant(),
    queryFn: async () => unwrap(await api.getAssistantConfig({ headers: tenantHeader() })),
  });
}

export function useUpdateAssistantConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateAssistantConfigInput) =>
      unwrap(await api.updateAssistantConfig({ headers: tenantHeader(), body: patch })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: settingsKeys.assistant() }),
  });
}

// ── Documentos requeridos del crédito (lo que pide el bot), ADMIN ───────────
export function useDocumentRequirements() {
  return useQuery({
    queryKey: settingsKeys.documents(),
    queryFn: async () => unwrap(await api.getDocumentRequirements({ headers: tenantHeader() })),
  });
}

export function useSetDocumentRequirements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetDocumentRequirementsInput) =>
      unwrap(await api.setDocumentRequirements({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: settingsKeys.documents() }),
  });
}

// ── Canales de WhatsApp (número → zona), ADMIN ──────────────────────────────
export const channelKeys = { all: ["whatsapp-channels"] as const };

export function useWhatsappChannels() {
  return useQuery({
    queryKey: channelKeys.all,
    queryFn: async () => unwrap(await api.listChannels({ headers: tenantHeader() })),
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { phoneNumberId: string; zoneId: string }) =>
      unwrap(await api.createChannel({ headers: tenantHeader(), body: input })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.deleteChannel({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}
