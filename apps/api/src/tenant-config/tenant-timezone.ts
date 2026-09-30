import { sql } from 'drizzle-orm';
import { businessDateOf, DEFAULT_TIME_ZONE } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/**
 * Zona horaria IANA de la EMPRESA (`operational_settings.timeZone`, Ajustes → General). Es la ÚNICA
 * fuente del "hoy" y de los cortes: liquidación, fecha de los pagos, rendición, cartera,
 * recordatorios y migrados. Sin configurar, la del dominio por defecto.
 */
export async function resolveTenantTimeZone(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT operational_settings->>'timeZone' AS time_zone
    FROM tenant_config WHERE tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ time_zone: string | null }>;
  return rows[0]?.time_zone ?? DEFAULT_TIME_ZONE;
}

/** Día de negocio de hoy (YYYY-MM-DD) en la zona horaria del tenant. */
export async function tenantToday(
  tx: Tx,
  tenantId: string,
  now = new Date(),
): Promise<string> {
  return businessDateOf(now, await resolveTenantTimeZone(tx, tenantId));
}
