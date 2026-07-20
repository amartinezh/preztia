import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CollectionLogEntry } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

interface LogRow {
  kind: 'NOTE' | 'VISIT';
  at: string;
  author_id: string;
  author_name: string | null;
  body: string | null;
  overdue_count_at_visit: number | null;
}

/**
 * Read model de la BITÁCORA de cobranza de un crédito: une observaciones (`collection_note`) y
 * visitas (`collection_visit`) en un solo timeline ordenado por fecha (desc). El nombre del autor
 * se toma del email del `app_user`. Solo lectura, bajo rol `app` + RLS (aísla el tenant). La
 * consume el cobrador (detalle del cobro) y el admin/coordinador (historial del cliente).
 */
@Injectable()
export class CollectionLogRepository {
  async list(input: {
    tenantId: string;
    creditId: string;
  }): Promise<CollectionLogEntry[]> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      // `to_char(... AT TIME ZONE 'UTC', …)` produce ISO-8601 UTC (parseable por el cliente); el
      // formato de ancho fijo hace que ORDER BY textual coincida con el orden cronológico.
      const isoUtc = (col: ReturnType<typeof sql>) =>
        sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
      const rows = (await tx.execute(sql`
        SELECT 'NOTE' AS kind, ${isoUtc(sql`n.created_at`)} AS at, n.author_id::text AS author_id,
               u.email AS author_name, n.body AS body, NULL::int AS overdue_count_at_visit
        FROM collection_note n
        LEFT JOIN app_user u ON u.id = n.author_id
        WHERE n.credit_id = ${input.creditId}
        UNION ALL
        SELECT 'VISIT' AS kind, ${isoUtc(sql`v.visited_at`)} AS at, v.collector_id::text AS author_id,
               u.email AS author_name, NULL AS body, v.overdue_count_at_visit AS overdue_count_at_visit
        FROM collection_visit v
        LEFT JOIN app_user u ON u.id = v.collector_id
        WHERE v.credit_id = ${input.creditId}
        ORDER BY at DESC
      `)) as unknown as LogRow[];

      return rows.map((row) => ({
        kind: row.kind,
        at: row.at,
        authorId: row.author_id,
        authorName: row.author_name,
        body: row.body,
        overdueCountAtVisit:
          row.overdue_count_at_visit === null
            ? null
            : Number(row.overdue_count_at_visit),
      }));
    });
  }
}
