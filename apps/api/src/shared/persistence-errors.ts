import { ConflictError } from '@preztiaos/domain';

// Código SQLSTATE de violación de restricción única en PostgreSQL.
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/**
 * Traduce una violación de unicidad de Postgres en un `ConflictError` de dominio (→ 409 en
 * la frontera). Cualquier otro error se propaga sin tocar. Mantiene la regla de "errores
 * explícitos": el caso de uso no inspecciona códigos SQL.
 */
export async function mapUniqueViolation<T>(
  operation: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(message);
    throw error;
  }
}
