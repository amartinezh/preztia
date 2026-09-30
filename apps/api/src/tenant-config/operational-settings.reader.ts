import { sql } from 'drizzle-orm';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  type OperationalSettings,
} from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/**
 * Ajustes operativos del tenant DENTRO de una transacción, mezclados con sus valores por defecto
 * (las filas guardadas antes de una clave nueva la reciben con su default).
 */
export async function readOperationalSettingsTx(
  tx: Tx,
  tenantId: string,
): Promise<OperationalSettings> {
  const rows = (await tx.execute(sql`
    SELECT operational_settings AS settings FROM tenant_config WHERE tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ settings: Partial<OperationalSettings> | null }>;
  return { ...DEFAULT_OPERATIONAL_SETTINGS, ...(rows[0]?.settings ?? {}) };
}
