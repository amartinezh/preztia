// El repositorio abre la conexión del plano de control al cargarse: aquí solo interesan sus listas.
jest.mock('./platform-uow', () => ({}));

import { schema } from '@preztiaos/db';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import {
  PURGE_ORDER,
  RETAINED_TENANT_TABLES,
} from './tenant-data-purge.repository';

/** Tablas del esquema Drizzle que pertenecen a un tenant (tienen columna `tenant_id`). */
function tenantTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter(
    (value): value is PgTable =>
      value instanceof PgTable &&
      getTableConfig(value).columns.some((c) => c.name === 'tenant_id'),
  );
}

const nameOf = (table: PgTable): string => getTableConfig(table).name;

describe('Purga de datos del tenant', () => {
  it('decide explícitamente el destino de TODA tabla con tenant_id (purgar o conservar)', () => {
    const decided = new Set([...PURGE_ORDER, ...RETAINED_TENANT_TABLES]);
    const undecided = tenantTables()
      .map(nameOf)
      .filter((name) => !decided.has(name));

    // Una tabla fuera de ambas listas dejaría filas huérfanas del tenant tras la purga.
    expect(undecided).toEqual([]);
  });

  it('no purga y conserva la misma tabla a la vez, ni la lista dos veces', () => {
    const retained = new Set(RETAINED_TENANT_TABLES);
    expect(PURGE_ORDER.filter((name) => retained.has(name))).toEqual([]);
    expect(new Set(PURGE_ORDER).size).toBe(PURGE_ORDER.length);
  });

  it('solo nombra tablas que existen en el esquema', () => {
    const existing = new Set(tenantTables().map(nameOf));
    const unknown = [...PURGE_ORDER, ...RETAINED_TENANT_TABLES].filter(
      (name) => !existing.has(name),
    );
    expect(unknown).toEqual([]);
  });

  it('borra cada hijo antes que el padre al que apunta su clave foránea', () => {
    const position = new Map(PURGE_ORDER.map((name, index) => [name, index]));
    const violations: string[] = [];

    for (const table of tenantTables()) {
      const child = nameOf(table);
      for (const fk of getTableConfig(table).foreignKeys) {
        const parent = nameOf(fk.reference().foreignTable);
        const childAt = position.get(child);
        const parentAt = position.get(parent);
        if (parentAt === undefined) continue; // el padre se conserva
        if (childAt === undefined || childAt > parentAt) {
          violations.push(`${child} → ${parent}`);
        }
      }
    }

    // Una violación haría fallar el DELETE del padre y revertiría la purga completa.
    expect(violations).toEqual([]);
  });
});
