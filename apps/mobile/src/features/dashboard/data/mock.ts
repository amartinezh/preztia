import type { DashboardKpisOutput } from "@preztiaos/contracts";

/**
 * Set de datos de prueba del dashboard. Estructurado igual que el DTO del backend para que la
 * pantalla y sus gráficos sean completamente funcionales antes de conectar datos reales. Dinero
 * en unidades menores (centavos), coherente con el resto del sistema.
 */
export const mockDashboardKpis: DashboardKpisOutput = {
  currency: "COP",
  treasury: {
    cashAvailableMinor: 4_85_000_00,
    portfolioActiveMinor: 32_40_000_00,
    portfolioOverdueMinor: 5_12_000_00,
  },
  applications: {
    approved: 128,
    inProgress: 34,
    rejected: 19,
  },
  risk: {
    documentUploadAttempts: 412,
    fraudAttemptsDetected: 23,
  },
};
