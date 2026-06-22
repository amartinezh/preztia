import { useQuery } from "@tanstack/react-query";
import type { DashboardKpisOutput } from "@preztiaos/contracts";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { mockDashboardKpis } from "../data/mock";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  kpis: () => [...dashboardKeys.all, "kpis"] as const,
};

/**
 * KPIs del dashboard inicial. Mientras el backend no tenga datos sembrados, `placeholderData`
 * entrega el set de prueba para que la pantalla (y sus gráficos) se aprecien de inmediato; en
 * cuanto llega la respuesta real la reemplaza sin parpadeo.
 */
export function useDashboardKpis() {
  return useQuery<DashboardKpisOutput>({
    queryKey: dashboardKeys.kpis(),
    queryFn: async () => unwrap(await api.getDashboardKpis({ headers: tenantHeader() })),
    placeholderData: mockDashboardKpis,
  });
}
