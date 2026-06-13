import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Carga el .env de la raíz del monorepo (igual que src/env.ts).
config({ path: resolve(__dirname, '../../../.env') });

import { sql } from 'drizzle-orm';
import { createDb, schema } from '@preztiaos/db';
import { hashPassword } from '../src/auth/password';

/**
 * Siembra un usuario operador de prueba para poder usar /auth/login.
 *
 * Usa DATABASE_URL (dueño del esquema) y fija `app.current_tenant` dentro de la
 * transacción para satisfacer la política RLS de app_user (WITH CHECK). Idempotente
 * por email (ON CONFLICT DO NOTHING). Configurable por variables de entorno:
 *   SEED_TENANT_ID, SEED_EMAIL, SEED_PASSWORD, SEED_ROLE, SEED_ZONE_PATHS (csv)
 */
async function main() {
  const tenantId = process.env.SEED_TENANT_ID ?? randomUUID();
  const email = (process.env.SEED_EMAIL ?? 'admin@preztia.test').toLowerCase();
  const password = process.env.SEED_PASSWORD ?? 'changeme-123';
  const role = (process.env.SEED_ROLE ?? 'ADMIN') as
    | 'ADMIN'
    | 'COORDINATOR'
    | 'COLLECTOR';
  const zonePaths = (process.env.SEED_ZONE_PATHS ?? '')
    .split(',')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurado');

  const db = createDb(databaseUrl);
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
    );
    await tx
      .insert(schema.appUser)
      .values({ tenantId, email, passwordHash, role, zonePaths })
      .onConflictDoNothing({ target: schema.appUser.email });
  });

  console.log('Usuario sembrado (o ya existía):');
  console.log({ tenantId, email, role, zonePaths });
  console.log(
    `Login: POST /auth/login { "email": "${email}", "password": "${password}" }`,
  );
  console.log(`Recuerda enviar x-tenant-id: ${tenantId} en las peticiones.`);
  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
