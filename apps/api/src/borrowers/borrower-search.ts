import { ilike, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';

/** Patrón ILIKE de coincidencia parcial: el término puede aparecer en cualquier posición. */
export function containsPattern(term: string): string {
  return `%${term}%`;
}

/** "Nombre Apellido" tal como lo escribe quien busca, sin exigir acertar el campo exacto. */
export const borrowerFullName: SQL = sql`${schema.borrower.firstName} || ' ' || ${schema.borrower.lastName}`;

/**
 * Búsqueda unificada de clientes (hallazgo A5): un solo campo que coincide, por OR, con el
 * nombre completo, la cédula o el teléfono. La comparten Cartera y Clientes para que las dos
 * listas encuentren lo mismo con el mismo texto.
 */
export function borrowerSearchPredicate(q: string): SQL {
  const pattern = containsPattern(q);
  return or(
    ilike(borrowerFullName, pattern),
    ilike(schema.borrower.nationalId, pattern),
    ilike(schema.borrower.phone, pattern),
  ) as SQL;
}
