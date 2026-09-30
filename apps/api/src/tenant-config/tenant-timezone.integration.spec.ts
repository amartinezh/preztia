import { randomUUID } from 'node:crypto';
import { DueTenantsRepository } from '../collections/due-tenants.repository';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { resolveTenantTimeZone, tenantToday } from './tenant-timezone';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// La zona horaria de la EMPRESA (Ajustes → General, `operational_settings.timeZone`) es la única
// fuente del "hoy" del sistema y de la hora de los recordatorios; ya no vive en la configuración
// del recordatorio. Contra Postgres real con RLS.
const describeDb = hasDb() ? describe : describe.skip;

const HOURS_PER_DAY = 24;
const tenants: string[] = [];

async function seedTenant(settings: {
  operational?: Record<string, unknown>;
  reminder?: Record<string, unknown>;
}): Promise<string> {
  const db = owner();
  const tenant = randomUUID();
  tenants.push(tenant);
  await db`INSERT INTO tenant_config (tenant_id, operational_settings, collection_reminder_settings)
    VALUES (${tenant}, ${db.json((settings.operational ?? {}) as never)}, ${db.json((settings.reminder ?? {}) as never)})`;
  return tenant;
}

/** Hora actual (0–23) en una zona horaria. */
function hourIn(timeZone: string): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  return hour % HOURS_PER_DAY;
}

describeDb('Zona horaria de la empresa (integración)', () => {
  afterAll(async () => {
    for (const tenant of tenants) await cleanupTenant(tenant);
    await closeOwner();
  });

  it('el "hoy" del sistema sale de la zona horaria de la empresa, no del recordatorio', async () => {
    // Una zona con otro día casi siempre: Kiritimati (UTC+14) frente a la del recordatorio viejo.
    const tenant = await seedTenant({
      operational: { timeZone: 'Pacific/Kiritimati' },
      reminder: { timezone: 'America/Bogota' },
    });
    const [zone, today] = await withTenantTxFor(tenant, async (tx) => [
      await resolveTenantTimeZone(tx, tenant),
      await tenantToday(tx, tenant),
    ]);
    expect(zone).toBe('Pacific/Kiritimati');
    expect(today).toBe(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Pacific/Kiritimati',
      }).format(new Date()),
    );
  });

  it('sin configurar, la empresa usa la zona por defecto (Bogotá)', async () => {
    const tenant = await seedTenant({});
    const zone = await withTenantTxFor(tenant, (tx) =>
      resolveTenantTimeZone(tx, tenant),
    );
    expect(zone).toBe('America/Bogota');
  });

  it('el recordatorio se envía a la hora local de la zona horaria de la EMPRESA', async () => {
    const zone = 'Asia/Tokyo';
    const tenant = await seedTenant({
      operational: { timeZone: zone },
      reminder: {
        enabled: true,
        sendHourLocal: hourIn(zone),
        timezone: 'America/Bogota',
      },
    });
    const due = await new DueTenantsRepository().listDueNow();
    expect(due).toContain(tenant);
  });
});
