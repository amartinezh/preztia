import { createDb, type Db } from '@preztiaos/db';
import { sql } from 'drizzle-orm';
import { tenantStorage } from './tenant-context';

const db = createDb(process.env.APP_DATABASE_URL!); // rol 'app' (sin bypass de RLS)

/**
 * Tipo de la transacción de Drizzle, derivado del cliente `Db`. Tipar `tx` (antes
 * `any`) propaga el tipado a todos los repositorios y elimina los `no-unsafe-*` de raíz,
 * sin cambiar el comportamiento en ejecución.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Transacción con el tenant del contexto actual (AsyncLocalStorage). */
export async function withTenantTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('Sin contexto de tenant');
  return withTenantTxFor(ctx.tenantId, fn);
}

/**
 * Transacción con un tenant explícito. Útil cuando el tenant no viene del
 * request HTTP sino que se resolvió antes (p. ej. desde el webhook de WhatsApp).
 */
export async function withTenantTxFor<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Resuelve el tenant a partir del phone_number_id de WhatsApp. Usa una función
 * SECURITY DEFINER acotada porque la consulta es previa a tener contexto de
 * tenant (no se puede leer tenant_config bajo RLS sin saber el tenant todavía).
 */
export async function resolveTenantByWhatsappPhone(
  phoneNumberId: string,
): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT resolve_tenant_by_whatsapp_phone(${phoneNumberId}) AS tenant_id`,
  )) as Array<{ tenant_id: string | null }>;
  return rows[0]?.tenant_id ?? null;
}

/** Fila mínima del usuario para autenticar y construir el JWT. */
export interface LoginUserRow {
  id: string;
  /** `null` para el SUPER_ADMIN (plano de control, sin tenant). */
  tenantId: string | null;
  passwordHash: string;
  role: string;
  zonePaths: string[];
  active: boolean;
}

/**
 * Busca el usuario por email para el LOGIN, que ocurre sin contexto de tenant.
 * Usa la función `find_app_user_for_login` (SECURITY DEFINER) por el mismo motivo
 * que `resolveTenantByWhatsappPhone`: no se puede leer `app_user` bajo RLS sin
 * conocer aún el tenant. No relaja RLS desde el código de aplicación.
 */
export async function findAppUserForLogin(
  email: string,
): Promise<LoginUserRow | null> {
  const rows = (await db.execute(
    sql`SELECT id, tenant_id, password_hash, role, zone_paths, active
        FROM find_app_user_for_login(${email})`,
  )) as Array<{
    id: string;
    tenant_id: string | null;
    password_hash: string;
    role: string;
    zone_paths: string[];
    active: boolean;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    passwordHash: row.password_hash,
    role: row.role,
    zonePaths: row.zone_paths,
    active: row.active,
  };
}
