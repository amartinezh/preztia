import { DomainError } from "../shared/money";

// Utilidades puras sobre rutas jerárquicas de zonas (ltree de PostgreSQL). Una ruta es
// una secuencia de etiquetas separadas por punto: `co.antioquia.medellin`. El dominio
// construye y valida rutas y decide pertenencia a un subárbol (authZ de alcance), sin
// conocer la base de datos. El índice GiST y la columna `ltree` son detalle de infra.

// ltree solo admite etiquetas [A-Za-z0-9_]; aquí las normalizamos a minúsculas.
const LABEL_PATTERN = /^[a-z0-9_]+$/;
const MAX_LABEL_LENGTH = 63; // límite de etiqueta ltree

/** Valida una etiqueta de zona; lanza `DomainError` si no es un label ltree válido. */
export function assertValidLabel(label: string): void {
  if (!LABEL_PATTERN.test(label) || label.length > MAX_LABEL_LENGTH) {
    throw new DomainError(
      "La etiqueta de zona debe ser [a-z0-9_] y no exceder 63 caracteres",
    );
  }
}

/**
 * Convierte un nombre legible en una etiqueta ltree estable (slug): minúsculas, espacios
 * y signos → `_`, sin acentos. No garantiza unicidad (eso lo resuelve el repositorio).
 */
export function toLabel(name: string): string {
  const normalized = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita diacríticos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) throw new DomainError("Nombre de zona inválido");
  return normalized.slice(0, MAX_LABEL_LENGTH);
}

/**
 * Construye la ruta de una zona hija. Si no hay padre, la zona es raíz y su ruta es la
 * propia etiqueta. Invariante: el resultado es siempre una ruta ltree válida.
 */
export function buildChildPath(parentPath: string | null, label: string): string {
  assertValidLabel(label);
  if (parentPath === null) return label;
  assertValidPath(parentPath);
  return `${parentPath}.${label}`;
}

/** Valida una ruta completa (cada segmento es un label válido). */
export function assertValidPath(path: string): void {
  const segments = path.split(".");
  if (segments.length === 0) throw new DomainError("Ruta de zona vacía");
  for (const segment of segments) assertValidLabel(segment);
}

/**
 * ¿`path` cae dentro de alguno de los subárboles `scopes`? Una ruta pertenece a un scope
 * si es exactamente el scope o un descendiente (`scope.algo`). Sin scopes ⇒ nunca (el
 * usuario sin asignación no ve ninguna zona). Replica el criterio del `ZoneScopeGuard`.
 */
export function isWithinScope(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}.`));
}

/** ¿Todas las rutas `paths` caen dentro de `scopes`? Útil para validar asignaciones. */
export function allWithinScope(paths: readonly string[], scopes: readonly string[]): boolean {
  return paths.every((path) => isWithinScope(path, scopes));
}
