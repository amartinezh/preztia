import { sql } from 'drizzle-orm';
import type { Tx } from '../tenancy/unit-of-work';

const DEFAULT_CRITICAL_OVERDUE_THRESHOLD = 3;

/**
 * Umbral de cuotas vencidas por DEFECTO (env `CRITICAL_OVERDUE_THRESHOLD`). Sirve de respaldo
 * cuando el tenant aún no tiene el umbral configurado en `tenant_config`.
 */
export function criticalOverdueThreshold(): number {
  const n = Number(process.env.CRITICAL_OVERDUE_THRESHOLD);
  return Number.isFinite(n) && n >= 1
    ? Math.floor(n)
    : DEFAULT_CRITICAL_OVERDUE_THRESHOLD;
}

/**
 * Umbral vigente de cuotas vencidas del tenant, resuelto desde su configuración
 * (`operational_settings.visitOverdueThreshold`). Es el ÚNICO número que comparten el
 * agendamiento de visitas del cobrador y el mapa de cobro (bandera `critical`). Fallback: el env
 * `CRITICAL_OVERDUE_THRESHOLD` y, en su defecto, 3. Se lee dentro de la `tx` del read model (RLS).
 */
export async function resolveOverdueThreshold(
  tx: Tx,
  tenantId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT (operational_settings->>'visitOverdueThreshold')::int AS threshold
    FROM tenant_config
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `)) as unknown as Array<{ threshold: number | null }>;
  const configured = rows[0]?.threshold;
  return configured != null && configured >= 1
    ? Math.floor(Number(configured))
    : criticalOverdueThreshold();
}
