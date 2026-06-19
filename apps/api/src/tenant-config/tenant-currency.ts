import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Resolver de la MONEDA por tenant (reemplaza el env global CREDIT_CURRENCY). La moneda es
// prácticamente estática por empresa, así que se cachea en memoria; `invalidateTenantCurrency`
// limpia la entrada si algún día se permite editarla. Fallback al env para tenants sin config.
const cache = new Map<string, string>();

function fallbackCurrency(): string {
  return process.env.CREDIT_CURRENCY ?? 'COP';
}

/** Moneda del tenant (ISO 4217). Cacheada; lee `tenant_config.currency` bajo RLS. */
export async function resolveTenantCurrency(tenantId: string): Promise<string> {
  const cached = cache.get(tenantId);
  if (cached) return cached;

  const value = await withTenantTxFor(tenantId, async (tx) => {
    const [row] = await tx
      .select({ currency: schema.tenantConfig.currency })
      .from(schema.tenantConfig)
      .where(eq(schema.tenantConfig.tenantId, tenantId))
      .limit(1);
    return row?.currency ?? fallbackCurrency();
  });

  cache.set(tenantId, value);
  return value;
}

/** Invalida la moneda cacheada de un tenant (tras editar su configuración). */
export function invalidateTenantCurrency(tenantId: string): void {
  cache.delete(tenantId);
}
