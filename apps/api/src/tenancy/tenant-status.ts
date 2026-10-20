import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { TenantStatus } from '@preztiaos/domain';
import { withTenantTxFor } from './unit-of-work';

// Estado operativo del tenant para la autorización de cada sesión. Se lee bajo RLS (el rol `app`
// solo ve la fila de su propio tenant) y se recuerda unos segundos para no sumar una consulta a
// cada petición. La regla de qué estado deja operar es del dominio (`isTenantOperating`).

/** Tiempo máximo que una suspensión tarda en cortar las sesiones vigentes de otra instancia. */
const STATUS_CACHE_MS = 30_000;

const cache = new Map<
  string,
  { status: TenantStatus | null; expiresAt: number }
>();

/**
 * Estado del tenant (null si ya no existe). `fresh` ignora la caché: el login y la renovación de
 * sesión leen siempre el valor vigente.
 */
export async function tenantStatusOf(
  tenantId: string,
  options: { fresh?: boolean } = {},
): Promise<TenantStatus | null> {
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (!options.fresh && cached && cached.expiresAt > now) return cached.status;
  const status = await withTenantTxFor(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: schema.tenant.status })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId))
      .limit(1);
    return row?.status ?? null;
  });
  cache.set(tenantId, { status, expiresAt: now + STATUS_CACHE_MS });
  return status;
}

/** Olvida el estado recordado (el SUPER_ADMIN lo acaba de cambiar en esta instancia). */
export function forgetTenantStatus(tenantId: string): void {
  cache.delete(tenantId);
}
