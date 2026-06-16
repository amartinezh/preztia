import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePaymentPlanInput,
  UpdatePaymentPlanInput,
} from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

// React Query sobre el contrato ts-rest de planes de pago. Toda mutación invalida la lista para
// reflejar el invariante del default (cuando uno pasa a default, el server quita el de los demás).
export const paymentPlanKeys = {
  all: ["payment-plans"] as const,
  list: () => [...paymentPlanKeys.all, "list"] as const,
};

export function usePaymentPlans() {
  return useQuery({
    queryKey: paymentPlanKeys.list(),
    queryFn: async () => unwrap(await api.list({ headers: tenantHeader() })),
  });
}

export function useCreatePaymentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePaymentPlanInput) =>
      unwrap(await api.create({ headers: tenantHeader(), body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentPlanKeys.all }),
  });
}

export function useUpdatePaymentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: UpdatePaymentPlanInput }) =>
      unwrap(
        await api.update({ headers: tenantHeader(), params: { id: input.id }, body: input.patch }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentPlanKeys.all }),
  });
}

export function useSetDefaultPaymentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.setDefault({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentPlanKeys.all }),
  });
}

export function useDeletePaymentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.remove({ headers: tenantHeader(), params: { id }, body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: paymentPlanKeys.all }),
  });
}
