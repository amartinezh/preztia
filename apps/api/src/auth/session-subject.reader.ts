import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { withPlatformTx } from '../platform/platform-uow';

/** Usuario dueño de una sesión, leído de nuevo al renovarla. */
export interface SessionSubject {
  readonly role: string;
  readonly zonePaths: string[];
  readonly active: boolean;
}

/**
 * Relee al usuario de una sesión para RENOVARLA: así un usuario desactivado no sigue renovando y
 * los cambios de rol o de zonas entran en la sesión siguiente. Un usuario del tenant se lee bajo
 * RLS de su tenant; el SUPER_ADMIN (sin tenant), por la conexión del plano de control.
 */
export async function loadSessionSubject(input: {
  userId: string;
  tenantId: string;
}): Promise<SessionSubject | null> {
  const read = async (
    tx: Parameters<Parameters<typeof withPlatformTx>[0]>[0],
  ) => {
    const [row] = await tx
      .select({
        role: schema.appUser.role,
        zonePaths: schema.appUser.zonePaths,
        active: schema.appUser.active,
      })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, input.userId))
      .limit(1);
    return row ?? null;
  };
  return input.tenantId
    ? withTenantTxFor(input.tenantId, read)
    : withPlatformTx(read);
}
