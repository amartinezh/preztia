import { minorToMajor } from "@preztiaos/ui";

// Separador decimal de la región (es-CO, pt-BR): el que `parseMoneyInput` lee.
const DECIMAL_SEPARATOR = ",";
const FRACTION_DIGITS = 2;

/**
 * Texto inicial de un `MoneyInput` a partir de un monto en unidades menores: "20000" si es entero
 * o "1500,50" si trae centavos. Inverso de `parseMoneyInput`: lo prellenado siempre se vuelve a
 * leer como el mismo entero menor, así el campo nunca arranca con un texto que rechazaría.
 */
export function moneyInputText(amountMinor: number): string {
  const major = minorToMajor(amountMinor);
  return Number.isInteger(major)
    ? String(major)
    : major.toFixed(FRACTION_DIGITS).replace(".", DECIMAL_SEPARATOR);
}
