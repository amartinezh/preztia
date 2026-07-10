import { createDb, schema, type Db } from '@preztiaos/db';
import { eq, sql } from 'drizzle-orm';
import { tenantStorage } from './tenant-context';
import { decryptOptionalSecret } from '../shared/secret-cipher';

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

/**
 * Resuelve el `zone_path` (ltree) del canal de WhatsApp por su phone_number_id, para estampar
 * la zona en conversaciones y solicitudes. SECURITY DEFINER (previa al contexto de tenant).
 * `null` si el canal no está mapeado a una zona.
 */
export async function resolveZonePathByWhatsappPhone(
  phoneNumberId: string,
): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT resolve_zone_path_by_whatsapp_phone(${phoneNumberId})::text AS zone_path`,
  )) as Array<{ zone_path: string | null }>;
  return rows[0]?.zone_path ?? null;
}

/** Credenciales de Meta (Graph API) de un canal, ya descifradas. `null` en los campos no cargados. */
export interface WhatsappChannelCredentials {
  accessToken: string | null;
  appSecret: string | null;
  graphVersion: string | null;
}

/**
 * Resuelve las credenciales del canal por su `phone_number_id`. Resuelve primero el tenant (misma
 * función SECURITY DEFINER que el resto del webhook) y luego lee la fila bajo RLS con el tenant ya
 * fijado (defensa en profundidad: el aislamiento lo aplica PG). Descifra los secretos en Node.
 * `null` si el número no está mapeado a un canal ⇒ el llamador cae a las variables de entorno.
 */
export async function resolveWhatsappCredentialsByPhone(
  phoneNumberId: string,
): Promise<WhatsappChannelCredentials | null> {
  const tenantId = await resolveTenantByWhatsappPhone(phoneNumberId);
  if (!tenantId) return null;

  return withTenantTxFor(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        accessToken: schema.whatsappChannel.accessToken,
        appSecret: schema.whatsappChannel.appSecret,
        graphVersion: schema.whatsappChannel.graphVersion,
      })
      .from(schema.whatsappChannel)
      .where(eq(schema.whatsappChannel.phoneNumberId, phoneNumberId))
      .limit(1);
    if (!row) return null;
    return {
      accessToken: decryptOptionalSecret(row.accessToken),
      appSecret: decryptOptionalSecret(row.appSecret),
      graphVersion: row.graphVersion,
    };
  });
}

/**
 * Comprueba si el hash SHA-256 (hex) presentado en el handshake GET del webhook coincide con el de
 * algún canal configurado. Es previo al contexto de tenant (el handshake no trae phone_number_id),
 * por eso usa una función SECURITY DEFINER acotada, igual que `resolveTenantByWhatsappPhone`.
 */
export async function whatsappVerifyTokenHashExists(
  sha256Hex: string,
): Promise<boolean> {
  const rows = (await db.execute(
    sql`SELECT whatsapp_verify_token_hash_exists(${sha256Hex}) AS ok`,
  )) as Array<{ ok: boolean | null }>;
  return rows[0]?.ok === true;
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
