import { sql } from 'drizzle-orm';
import { businessDateOf } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/** Zona horaria por defecto cuando el tenant no la configuró (la misma del cron de cobranza). */
const DEFAULT_TIMEZONE = 'America/Bogota';

/**
 * Zona horaria IANA del tenant: la configurada para el cron de cobranza
 * (`collection_reminder_settings.timezone`). El día de negocio y las horas límite son locales a ella.
 */
export async function resolveTenantTimeZone(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT collection_reminder_settings->>'timezone' AS time_zone
    FROM tenant_config WHERE tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ time_zone: string | null }>;
  return rows[0]?.time_zone ?? DEFAULT_TIMEZONE;
}

/** Día de negocio de hoy (YYYY-MM-DD) en la zona horaria del tenant. */
export async function tenantToday(
  tx: Tx,
  tenantId: string,
  now = new Date(),
): Promise<string> {
  return businessDateOf(now, await resolveTenantTimeZone(tx, tenantId));
}
