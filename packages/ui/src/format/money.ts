/**
 * Formateo de dinero para PRESENTACIÓN. El dominio y el transporte siempre manejan
 * unidades menores enteras (`*_minor`); esta función solo convierte a texto legible.
 * No se usa para cálculos: nunca reintroduce coma flotante en la lógica de negocio.
 */

// La mayoría de monedas de la región (COP, BRL, USD) usan 2 decimales.
const DEFAULT_FRACTION_DIGITS = 2;

export function minorToMajor(amountMinor: number, fractionDigits = DEFAULT_FRACTION_DIGITS): number {
  return amountMinor / 10 ** fractionDigits;
}

export function formatMoney(amountMinor: number, currency: string, locale = "es-CO"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      minorToMajor(amountMinor),
    );
  } catch {
    // Degradación elegante si el runtime no trae datos de la moneda/locale.
    return `${currency} ${minorToMajor(amountMinor).toFixed(DEFAULT_FRACTION_DIGITS)}`;
  }
}

/** Convierte un monto en unidad mayor (lo que teclea el usuario) a entero menor. */
export function majorToMinor(amountMajor: number, fractionDigits = DEFAULT_FRACTION_DIGITS): number {
  return Math.round(amountMajor * 10 ** fractionDigits);
}
