import { or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { Session } from '../auth/require-role';

/**
 * Predicado SQL que acota un path de zona al alcance del actor (subárbol ltree). El ADMIN
 * gobierna todo su tenant (sin filtro → `undefined`); coordinador/cobrador solo ven su(s)
 * subárbol(es); sin zonas asignadas no ven ninguna. Materializa el `ZoneScopeGuard` (§10).
 */
export function zoneScopePredicate(
  session: Session,
  pathColumn: SQL | typeof schema.zone.path = schema.zone.path,
): SQL | undefined {
  if (session.role === 'ADMIN') return undefined;
  if (session.zonePaths.length === 0) return sql`false`;
  const clauses = session.zonePaths.map(
    (scope) => sql`${pathColumn} <@ ${scope}::ltree`,
  );
  return or(...clauses);
}
