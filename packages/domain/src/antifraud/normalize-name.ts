// Normalización y comparación de nombres propios para los cruces antifraude.
// Los nombres llegan de fuentes distintas (OCR del documento, Receita Federal)
// con diferencias de acentos, mayúsculas y orden/cantidad de apellidos, así que
// la comparación exacta de strings produciría falsos positivos.

/** Quita acentos, signos y espacios repetidos; deja MAYÚSCULAS comparables. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas diacríticas (acentos, tildes)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Igualdad estricta tras normalizar (mismo nombre escrito distinto). */
export function namesMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return left.length > 0 && left === right;
}

/**
 * Coincidencia tolerante: verdadero si todos los tokens de un nombre están en el
 * otro (cubre abreviaciones: "JOAO SILVA" vs "JOAO DA SILVA SANTOS"). Exige al
 * menos dos tokens en el nombre más corto para no aceptar coincidencias triviales.
 */
export function namesLooselyMatch(a: string, b: string): boolean {
  if (namesMatch(a, b)) return true;
  const tokensA = normalizeName(a).split(" ").filter(Boolean);
  const tokensB = normalizeName(b).split(" ").filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  if (shorter.length < 2) return false;
  const longerSet = new Set(longer);
  return shorter.every((token) => longerSet.has(token));
}

/** ¿El nombre coincide (tolerante) con ALGUNO de la lista? */
export function nameMatchesAny(name: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => namesLooselyMatch(name, candidate));
}
