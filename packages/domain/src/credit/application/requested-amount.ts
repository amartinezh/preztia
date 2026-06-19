// Helpers puros (sin I/O) para la captura del monto solicitado por WhatsApp y para derivar los
// datos del cliente desde el OCR del documento de identidad. El webhook delega aquí para mantener
// el parseo testeable sin WhatsApp.

/** Centavos por unidad mayor (peso/real): el dominio razona siempre en unidades menores. */
const MINOR_PER_MAJOR = 100;

/**
 * Interpreta el monto que el cliente escribe ("300.000", "300000", "$ 300 mil" → 300000). Toma
 * solo los dígitos (tolera separadores de miles y símbolos) como unidades MAYORES y devuelve
 * unidades MENORES (enteras), o `null` si no hay un monto positivo interpretable.
 */
export function parseRequestedAmountMinor(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const major = Number(digits);
  if (!Number.isSafeInteger(major) || major <= 0) return null;
  return major * MINOR_PER_MAJOR;
}

/** Nombre y apellido derivados de un nombre completo (primer token = nombre; resto = apellido). */
export interface SplitName {
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Parte un nombre completo del OCR en nombre + apellido. El primer token es el nombre y el resto
 * el apellido; con un solo token, el apellido queda vacío. Colapsa espacios redundantes.
 */
export function splitFullName(fullName: string | null): SplitName {
  const tokens = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: "", lastName: "" };
  const [first, ...rest] = tokens;
  return { firstName: first!, lastName: rest.join(" ") };
}
