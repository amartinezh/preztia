import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Carga el .env de la raíz del monorepo (igual que los demás seeds). En producción las variables
// llegan por el entorno del contenedor y dotenv no las pisa.
config({ path: resolve(__dirname, '../../../../.env') });

import { sql } from 'drizzle-orm';
import { createDb, schema, type Db } from '@preztiaos/db';
import { addDays } from '@preztiaos/domain';
import { MinioTenantFilePurger } from '../../src/platform/tenant-file-purge.storage';
import { BusinessClock } from './clock';
import { TenantContext } from './context';
import { FileVault } from './files';
import { CONFIRM_PHRASE, resolveSeedOptions, type SeedOptions } from './guards';
import {
  capturePreservedState,
  extraSuperAdmins,
  foreignTenants,
  resolveMainTenantId,
  type PreservedState,
} from './preserve';
import {
  CO_SCENARIO,
  MAIN_SCENARIO,
  SUPER_ADMIN_EMAIL,
  SUSPENDED_SCENARIO,
  type TenantScenario,
} from './scenario';
import { simulateTenant } from './simulation';
import { passwordHashFor, seedStructure } from './structure';
import { verifySeed } from './verify';

/**
 * SEED COMPLETO de PreztiaOS: reemplaza los datos de la base por ~10 semanas de operación
 * simulada que cubren todas las funcionalidades (ver README.md de esta carpeta).
 *
 *   pnpm --filter api seed:full
 *
 * Conserva lo que no es dato de prueba (credenciales de IA, WhatsApp, Telegram y bancos, y las
 * contraseñas de los usuarios que ya existían) y falla cerrado contra bases no locales.
 */

/** Días antes del inicio de la historia en que "se configuró" cada tenant. */
const SETUP_LEAD_DAYS = 10;

async function main(): Promise<void> {
  const options = resolveSeedOptions(process.env);
  const db = createDb(options.databaseUrl);
  const preserved = await capturePreservedState(db);
  const scenarios = scenariosFor(preserved, options);
  assertNoForeignTenants(preserved, scenarios);

  const files = new FileVault(options.uploadFiles);
  if (options.uploadFiles)
    await purgeTenantFiles([
      ...preserved.tenantIds,
      ...scenarios.map((s) => s.id),
    ]);
  await truncateAll(db);
  await seedSuperAdmins(db, preserved, options);

  const now = new Date();
  const contexts: TenantContext[] = [];
  for (const scenario of scenarios) {
    const clock = new BusinessClock(
      scenario.operational.timeZone ?? 'America/Sao_Paulo',
      now,
    );
    const ctx = new TenantContext(scenario, scenario.id, clock, files, db);
    const start =
      scenario.historyWeeks > 0
        ? clock.mondayOf(clock.daysFromToday(-7 * scenario.historyWeeks))
        : null;
    await seedStructure({
      ctx,
      preserved,
      password: options.password,
      resetPasswords: options.resetPasswords,
      setupAt: clock.at(addDays(start ?? clock.today, -SETUP_LEAD_DAYS), 9),
      settlementStartDate: start,
    });
    if (start) await simulateTenant(ctx, start);
    contexts.push(ctx);
    console.log(`✔ ${scenario.name}: ${summaryLine(ctx)}`);
  }

  const report = await verifySeed(db, contexts);
  printSummary(contexts, report, files, options);
  if (report.failed.length > 0) process.exitCode = 1;
}

/** El tenant principal conserva el id real de producción (o el pedido por entorno). */
function scenariosFor(
  preserved: PreservedState,
  options: SeedOptions,
): TenantScenario[] {
  const mainId = resolveMainTenantId(
    preserved,
    MAIN_SCENARIO,
    options.mainTenantId,
  );
  return [{ ...MAIN_SCENARIO, id: mainId }, CO_SCENARIO, SUSPENDED_SCENARIO];
}

function assertNoForeignTenants(
  preserved: PreservedState,
  scenarios: readonly TenantScenario[],
): void {
  const foreign = foreignTenants(
    preserved,
    scenarios.map((s) => s.id),
  );
  if (foreign.length > 0 && process.env.SEED_CONFIRM !== CONFIRM_PHRASE) {
    throw new Error(
      `Hay ${foreign.length} tenant(s) que el seed no administra (${foreign.join(', ')}); se borrarían. ` +
        `Confirma con SEED_CONFIRM=${CONFIRM_PHRASE} o indica el principal con SEED_TENANT_ID.`,
    );
  }
}

/** Borra las evidencias de MinIO de los tenants (best-effort, como la purga de plataforma). */
async function purgeTenantFiles(tenantIds: readonly string[]): Promise<void> {
  const purger = new MinioTenantFilePurger();
  for (const id of new Set(tenantIds)) {
    try {
      await purger.purge(id);
    } catch {
      // MinIO caído: la bóveda lo reportará al intentar subir; los objetos huérfanos no rompen nada.
    }
  }
}

/** Vacía todas las tablas de `public` (conserva esquema, roles, políticas y migraciones). */
async function truncateAll(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL client_min_messages = warning`);
    await tx.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
  });
}

/** SUPER_ADMIN del plano de control (sin tenant) + los que ya existían. */
async function seedSuperAdmins(
  db: Db,
  preserved: PreservedState,
  options: SeedOptions,
): Promise<void> {
  await db.insert(schema.appUser).values({
    id: randomUUID(),
    tenantId: null,
    email: SUPER_ADMIN_EMAIL,
    passwordHash: await passwordHashFor(
      {
        preserved,
        password: options.password,
        resetPasswords: options.resetPasswords,
      },
      SUPER_ADMIN_EMAIL,
    ),
    role: 'SUPER_ADMIN',
    zonePaths: [],
  });
  for (const user of extraSuperAdmins(preserved)) {
    await db.insert(schema.appUser).values({ ...user, id: randomUUID() });
  }
}

function summaryLine(ctx: TenantContext): string {
  const s = ctx.stats;
  return `${ctx.borrowers.length} clientes · ${s.credits} créditos · ${s.payments} pagos (${s.pixPayments} PIX) · ${ctx.ledger.postings} asientos · ${s.applications} solicitudes · ${s.remittances} rendiciones · ${s.settlements} liquidaciones`;
}

function printSummary(
  contexts: readonly TenantContext[],
  report: Awaited<ReturnType<typeof verifySeed>>,
  files: FileVault,
  options: SeedOptions,
): void {
  console.log('\nInvariantes verificados sobre la base:');
  for (const name of report.passed) console.log(`  ✔ ${name}`);
  for (const f of report.failed) console.log(`  ✘ ${f.name} (${f.rows} filas)`);
  console.log(`\nArchivos de evidencia subidos a MinIO: ${files.uploaded}`);
  console.log('\nUsuarios (POST /auth/login):');
  console.log(`  SUPER_ADMIN  ${SUPER_ADMIN_EMAIL}`);
  for (const ctx of contexts) {
    console.log(
      `  [${ctx.scenario.name} · ${ctx.tenantId} · ${ctx.scenario.status}]`,
    );
    for (const user of ctx.users.values()) {
      const state = user.row.active ? '' : ' (inactivo)';
      console.log(`    ${user.role.padEnd(12)} ${user.email}${state}`);
    }
  }
  console.log(
    options.isShared
      ? '\nContraseña: la de SEED_PASSWORD para usuarios nuevos; los existentes conservan la suya.'
      : `\nContraseña de los usuarios nuevos: ${options.password} (los existentes conservan la suya).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // Los pools de postgres.js (seed + rol app de la API) mantienen el proceso vivo: se cierra explícito.
  .finally(() => setTimeout(() => process.exit(), 100));
