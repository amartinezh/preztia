// Estado del cliente en el mapa de "Posición de Clientes" (espejo de los colores del legado:
// azul = al día, blanco = sin préstamos, verde = con atrasos). Regla pura.

export const BORROWER_POSITION_STATUSES = ["NO_CREDIT", "CURRENT", "OVERDUE"] as const;
export type BorrowerPositionStatus = (typeof BORROWER_POSITION_STATUSES)[number];

/**
 * Clasifica al cliente para el mapa:
 * - sin créditos                 → `NO_CREDIT`
 * - con crédito y alguno atrasado → `OVERDUE`
 * - con crédito y todo al día     → `CURRENT`
 */
export function classifyBorrowerPosition(input: {
  hasCredits: boolean;
  anyOverdue: boolean;
}): BorrowerPositionStatus {
  if (!input.hasCredits) return "NO_CREDIT";
  return input.anyOverdue ? "OVERDUE" : "CURRENT";
}
