import { useQuery } from "@tanstack/react-query";
import type { DashboardKpisOutput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  kpis: () => [...dashboardKeys.all, "kpis"] as const,
};

/**
 * KPIs del panel de inicio. Sin `placeholderData`: en una pantalla de dinero nunca se pintan cifras
 * de ejemplo como si fueran reales; mientras carga, la pantalla muestra esqueletos.
 */
export function useDashboardKpis() {
  return useQuery<DashboardKpisOutput>({
    queryKey: dashboardKeys.kpis(),
    queryFn: async () => unwrap(await api.getDashboardKpis({ headers: tenantHeader() })),
  });
}
