import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { schema, type Db } from '@preztiaos/db';

// Búfer de escritura del seed: la simulación acumula las filas de un día y las persiste juntas,
// en orden seguro para las claves foráneas. Las entidades que cambian de estado con el tiempo
// (pagos, rendiciones, órdenes, solicitudes…) se registran UNA vez por REFERENCIA; en cada vaciado
// se reescriben las que cambiaron desde el anterior (INSERT … ON CONFLICT (id) DO UPDATE), así una
// mutación días después (un gasto revisado al día siguiente) nunca se pierde.

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const CHUNK_SIZE = 400;

/** Orden de escritura: los padres antes que los hijos (claves foráneas reales del esquema). */
const WRITE_ORDER: readonly PgTable[] = [
  schema.appUser,
  schema.cashBox,
  schema.borrower,
  schema.borrowerContact,
  schema.collectorClient,
  schema.borrowerNote,
  schema.borrowerList,
  schema.borrowerListMember,
  schema.changeRequest,
  schema.credit,
  schema.installment,
  schema.creditApplication,
  schema.creditApplicationDocument,
  schema.creditApplicationDocumentFile,
  schema.creditApplicationEvent,
  schema.documentExtraction,
  schema.documentValidation,
  schema.creditApplicationRejection,
  schema.processedInboundMessage,
  schema.conversationMessage,
  schema.conversationFailure,
  schema.telegramChatLink,
  schema.payment,
  schema.paymentAllocation,
  schema.paymentEvent,
  schema.fraudAssessment,
  schema.expense,
  schema.cashCount,
  schema.collectionRoute,
  schema.routeStop,
  schema.fieldOrder,
  schema.fieldOrderEvent,
  schema.incomingCredit,
  schema.providerWebhookEvent,
  schema.paymentCharge,
  schema.collectorRemittance,
  schema.cashTransaction,
  schema.bankReconciliation,
  schema.collectionNote,
  schema.collectionVisit,
  schema.collectorLocation,
  schema.idempotencyKey,
  schema.auditLog,
];

export class WriteBatch {
  private readonly inserts = new Map<PgTable, Row[]>();
  /** Entidades rastreadas durante toda la corrida, con la huella de lo último persistido. */
  private readonly tracked = new Map<
    PgTable,
    Map<string, { row: Row; persisted: string | null }>
  >();

  /** Fila inmutable (bitácoras, asientos, asignaciones): se inserta tal cual. */
  insert<T extends PgTable>(table: T, row: T['$inferInsert']): void {
    const rows = this.inserts.get(table) ?? [];
    rows.push(row as Row);
    this.inserts.set(table, rows);
  }

  /** Entidad con estado: se escribe con su valor vigente en cada vaciado en que cambie (requiere `id`). */
  track<T extends PgTable>(
    table: T,
    row: T['$inferInsert'] & { id: string },
  ): void {
    const rows =
      this.tracked.get(table) ??
      new Map<string, { row: Row; persisted: string | null }>();
    if (!rows.has(row.id))
      rows.set(row.id, { row: row as Row, persisted: null });
    this.tracked.set(table, rows);
  }

  async flush(db: Db): Promise<void> {
    const changed = this.changedRows();
    if (this.inserts.size === 0 && changed.size === 0) return;
    await db.transaction(async (tx) => {
      for (const table of WRITE_ORDER) {
        await writeUpserts(
          tx,
          table,
          (changed.get(table) ?? []).map((c) => c.entry.row),
        );
        await writeInserts(tx, table, this.inserts.get(table) ?? []);
      }
    });
    for (const rows of changed.values())
      for (const c of rows) c.entry.persisted = c.fingerprint;
    this.inserts.clear();
  }

  /** Entidades nuevas o modificadas desde el último vaciado (comparando su huella serializada). */
  private changedRows(): Map<
    PgTable,
    Array<{
      entry: { row: Row; persisted: string | null };
      fingerprint: string;
    }>
  > {
    const out = new Map<
      PgTable,
      Array<{
        entry: { row: Row; persisted: string | null };
        fingerprint: string;
      }>
    >();
    for (const [table, rows] of this.tracked) {
      for (const entry of rows.values()) {
        const fingerprint = JSON.stringify(entry.row);
        if (fingerprint === entry.persisted) continue;
        const list = out.get(table) ?? [];
        list.push({ entry, fingerprint });
        out.set(table, list);
      }
    }
    return out;
  }
}

async function writeInserts(
  tx: Tx,
  table: PgTable,
  rows: Row[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await tx.insert(table).values(rows.slice(i, i + CHUNK_SIZE));
  }
}

async function writeUpserts(
  tx: Tx,
  table: PgTable,
  rows: Row[],
): Promise<void> {
  if (rows.length === 0) return;
  const columns = getTableColumns(table);
  const idColumn = columns.id;
  if (!idColumn) throw new Error('Solo se rastrean entidades con columna id');
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await tx
      .insert(table)
      .values(chunk)
      .onConflictDoUpdate({
        target: idColumn,
        set: excludedSet(columns, chunk),
      });
  }
}

/** SET col = excluded.col para cada columna presente en las filas (menos el id). */
function excludedSet(
  columns: ReturnType<typeof getTableColumns>,
  rows: Row[],
): Record<string, SQL> {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  keys.delete('id');
  return Object.fromEntries(
    [...keys].map((key) => [key, sql.raw(`excluded."${columns[key]!.name}"`)]),
  );
}
