import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DueTenantsReader } from '@preztiaos/application';
import { withPlatformTx } from '../platform/platform-uow';

/**
 * Resuelve qué tenants deben enviar la cobranza AHORA. Es una consulta CROSS-TENANT (el cron no
 * tiene contexto de un tenant), por lo que usa la conexión de control-plane (`withPlatformTx`,
 * rol `platform` con BYPASSRLS) — la única puerta autorizada a datos de todos los tenants.
 *
 * Un tenant entra si su recordatorio está habilitado y su hora local configurada coincide con la
 * hora actual EN SU zona horaria. El cron corre cada hora; así cada tenant recibe su envío una vez
 * al día, a la hora que definió (default 7:00 AM).
 */
@Injectable()
export class DueTenantsRepository implements DueTenantsReader {
  async listDueNow(): Promise<string[]> {
    return withPlatformTx(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT tenant_id
        FROM tenant_config
        WHERE (collection_reminder_settings->>'enabled')::boolean IS TRUE
          AND (collection_reminder_settings->>'sendHourLocal')::int
              = EXTRACT(HOUR FROM (
                  now() AT TIME ZONE coalesce(collection_reminder_settings->>'timezone', 'America/Bogota')
                ))::int
      `)) as unknown as Array<{ tenant_id: string }>;
      return rows.map((r) => r.tenant_id);
    });
  }
}
