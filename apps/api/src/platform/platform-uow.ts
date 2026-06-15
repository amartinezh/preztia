import { createDb, type Db } from '@preztiaos/db';

// Conexión de CONTROL-PLANE: rol `platform` con BYPASSRLS. La usan EXCLUSIVAMENTE los
// endpoints protegidos por SuperAdminGuard (CRUD de tenants + provisión de admins), que
// operan cruzando tenants. El plano de datos sigue 100% con el rol `app` (NOBYPASSRLS).
// Fallback a DATABASE_URL (superusuario, también bypassa RLS) si no se define la conexión
// dedicada, para no romper entornos de desarrollo.
const platformUrl =
  process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
if (!platformUrl) {
  throw new Error('PLATFORM_DATABASE_URL (o DATABASE_URL) no configurado');
}
const db = createDb(platformUrl);

export type PlatformTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Transacción del plano de control. No fija `app.current_tenant`: el rol `platform`
 * BYPASSRLS, así que ve/gestiona todos los tenants. Es la ÚNICA puerta a datos
 * cross-tenant y solo se alcanza tras el SuperAdminGuard.
 */
export async function withPlatformTx<T>(
  fn: (tx: PlatformTx) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
