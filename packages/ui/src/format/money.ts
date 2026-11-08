/**
 * Formateo y lectura de dinero para PRESENTACIÓN. El dominio y el transporte siempre manejan
 * unidades menores enteras (`*_minor`); estas funciones solo convierten a/desde texto legible.
 * No se usan para cálculos: nunca reintroducen coma flotante en la lógica de negocio.
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

// Convención de escritura de la región (es-CO, pt-BR): el punto (o el espacio) separa miles y la
// coma separa decimales. "20.000" son veinte mil, no veinte; "1,5" es uno y medio.
const THOUSANDS_GROUP = /^\d{1,3}(?:[.\s]\d{3})*$/;
const PLAIN_INTEGER = /^\d+$/;
const NON_AMOUNT_CHARS = /[^\d.,\s-]/g;

/**
 * Lee un monto tecleado por una persona (convención es/pt) y lo devuelve en unidades menores.
 * Devuelve `null` cuando el texto NO es un monto inequívoco: vacío, letras sueltas, negativo,
 * más decimales que los de la moneda, o puntos que no agrupan de a tres ("1.5" es ambiguo).
 * Nunca convierte en silencio: la UI debe tratar `null` como "monto inválido" y no enviar.
 *
 * Invariantes:
 *  - `parseMoneyInput(formatPlain(minor)) === minor` para todo entero no negativo.
 *  - El resultado es un entero ≥ 0 o `null`; jamás `NaN`.
 */
export function parseMoneyInput(
  raw: string,
  fractionDigits = DEFAULT_FRACTION_DIGITS,
): number | null {
  // Se toleran símbolo de moneda y letras pegadas ("R$ 1.200", "COP 20.000"); el signo no.
  const text = raw.replace(NON_AMOUNT_CHARS, "").trim();
  if (text === "" || text.includes("-")) return null;

  const commaCount = (text.match(/,/g) ?? []).length;
  if (commaCount > 1) return null;
  const [integerPart, decimalPart = ""] = text.split(",") as [string, string?];

  const integerText = integerPart.trim();
  const integerOk = PLAIN_INTEGER.test(integerText) || THOUSANDS_GROUP.test(integerText);
  if (!integerOk) return null;
  if (decimalPart.length > fractionDigits || (decimalPart !== "" && !PLAIN_INTEGER.test(decimalPart))) {
    return null;
  }

  const integerDigits = integerText.replace(/[.\s]/g, "");
  const decimalDigits = decimalPart.padEnd(fractionDigits, "0");
  const minor = Number(`${integerDigits}${decimalDigits}`);
  return Number.isSafeInteger(minor) ? minor : null;
}
