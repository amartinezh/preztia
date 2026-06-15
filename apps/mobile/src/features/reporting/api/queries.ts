import { useMutation, useQuery } from "@tanstack/react-query";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const reportingKeys = {
  all: ["reporting"] as const,
  dashboard: () => [...reportingKeys.all, "dashboard"] as const,
  borrower: (id: string) => [...reportingKeys.all, "borrower", id] as const,
};

/** Panel del tenant (KPIs). */
export function useDashboard() {
  return useQuery({
    queryKey: reportingKeys.dashboard(),
    queryFn: async () => unwrap(await api.getDashboard({ headers: tenantHeader() })),
  });
}

/** Resumen de un cliente desde la última liquidada. `enabled` controla la carga diferida. */
export function useBorrowerReport(borrowerId: string | null) {
  return useQuery({
    queryKey: reportingKeys.borrower(borrowerId ?? "none"),
    enabled: borrowerId !== null,
    queryFn: async () =>
      unwrap(
        await api.getBorrowerReport({ headers: tenantHeader(), params: { id: borrowerId as string } }),
      ),
  });
}

/** Genera el CSV del listado de cuentas (el servidor lo arma; aquí solo se solicita). */
export function useExportAccounts() {
  return useMutation({
    mutationFn: async () => unwrap(await api.exportAccounts({ headers: tenantHeader() })),
  });
}
