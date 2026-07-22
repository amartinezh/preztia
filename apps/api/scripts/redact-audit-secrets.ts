import { config } from 'dotenv';
import { resolve } from 'node:path';

// Carga el .env de la raíz del monorepo (igual que src/env.ts).
config({ path: resolve(__dirname, '../../../.env') });

import { sql } from 'drizzle-orm';
import { createDb } from '@preztiaos/db';
import { sanitize } from '../src/observability/sanitize';

/**
 * REMEDIACIÓN puntual (auditoría de seguridad · hallazgo #5): vuelve a sanear los `payload`
 * ya escritos en `audit_log`.
 *
 * La versión anterior de `sanitize` comparaba el nombre del campo por igualdad EXACTA, así
 * que `appSecret`, `verifyToken` y `clientSecret` —campos reales de los contratos de canal de
 * WhatsApp y de cuenta bancaria— quedaron en CLARO en una bitácora que por diseño no se
 * edita. Este script es el único cierre posible: reescribe los payloads históricos con la
 * regla nueva (coincidencia por subcadena).
 *
 * Se ejecuta UNA vez, tras desplegar el `sanitize` endurecido. Es idempotente: correrlo de
 * nuevo no cambia nada porque los payloads ya saneados son punto fijo de `sanitize`.
 *
 * Usa DATABASE_URL (dueño del esquema). NO puede usar el rol `app`: la migración le revocó
 * UPDATE sobre `audit_log` justamente para que el historial sea append-only. Saltarse esa
 * garantía es deliberado y acotado a esta remediación.
 *
 *   pnpm --filter api exec ts-node scripts/redact-audit-secrets.ts
 */

interface AuditRow {
  id: string;
  payload: unknown;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no configurado');
  const db = createDb(url);

  const rows = (await db.execute(
    sql`SELECT id, payload FROM audit_log WHERE payload IS NOT NULL`,
  )) as unknown as AuditRow[];

  let redacted = 0;
  for (const row of rows) {
    const clean = sanitize(row.payload);
    // Solo se escribe lo que de verdad cambia: deja intacto (y sin tocar el WAL) el 99%
    // de la bitácora, y hace que el conteo final sea el número real de filas con secretos.
    if (JSON.stringify(clean) === JSON.stringify(row.payload)) continue;
    await db.execute(
      sql`UPDATE audit_log SET payload = ${JSON.stringify(clean)}::jsonb WHERE id = ${row.id}`,
    );
    redacted += 1;
  }

  console.log(
    `audit_log: ${rows.length} entradas revisadas, ${redacted} saneadas de nuevo.`,
  );
  if (redacted > 0) {
    console.log(
      'ATENCIÓN: los secretos expuestos estuvieron en la bitácora — ROTA esas credenciales ' +
        '(App Secret y verify token de WhatsApp, client secret de la cuenta bancaria).',
    );
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
