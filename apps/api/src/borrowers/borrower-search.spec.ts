import { PgDialect } from 'drizzle-orm/pg-core';
import { borrowerSearchPredicate, containsPattern } from './borrower-search';

/**
 * Especificación (Gherkin):
 *   Dado un texto escrito en el buscador de Clientes o de Cartera
 *   Cuando se arma el filtro de búsqueda unificada
 *   Entonces coincide parcialmente (ILIKE) con el nombre completo, O la cédula, O el teléfono,
 *   con el MISMO texto en las tres comparaciones y sin interpolarlo en el SQL (parámetros).
 */
describe('Búsqueda unificada de clientes', () => {
  const render = (q: string) =>
    new PgDialect().sqlToQuery(borrowerSearchPredicate(q));

  it('el patrón admite el término en cualquier posición', () => {
    expect(containsPattern('ana')).toBe('%ana%');
  });

  it('compara nombre completo, cédula y teléfono unidos por OR', () => {
    const { sql } = render('ana');
    expect(sql).toContain(
      `"first_name" || ' ' || "borrower"."last_name" ilike`,
    );
    expect(sql).toContain('"borrower"."national_id" ilike');
    expect(sql).toContain('"borrower"."phone" ilike');
    expect(sql.match(/ or /g)).toHaveLength(2);
  });

  it('envía el texto como parámetro, una vez por campo, nunca interpolado', () => {
    const { sql, params } = render("o'brien");
    expect(params).toEqual(["%o'brien%", "%o'brien%", "%o'brien%"]);
    expect(sql).not.toContain("o'brien");
  });
});
