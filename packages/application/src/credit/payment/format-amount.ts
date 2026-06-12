const MINOR_UNITS_PER_UNIT = 100;

/** Formatea un monto en unidades menores para mensajes al cliente (es-BR por PIX). */
export function formatAmount(amountMinor: number, currency: string): string {
  const units = amountMinor / MINOR_UNITS_PER_UNIT;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(units);
  } catch {
    return `${units.toFixed(2)} ${currency}`;
  }
}
