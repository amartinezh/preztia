import { createDb } from "@preztiaos/db";
import { sql } from "drizzle-orm";
import { tenantStorage } from "./tenant-context";

const db = createDb(process.env.APP_DATABASE_URL!); // rol 'app' (sin bypass de RLS)

/** Transacción con el tenant del contexto actual (AsyncLocalStorage). */
export async function withTenantTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error("Sin contexto de tenant");
  return withTenantTxFor(ctx.tenantId, fn);
}

/**
 * Transacción con un tenant explícito. Útil cuando el tenant no viene del
 * request HTTP sino que se resolvió antes (p. ej. desde el webhook de WhatsApp).
 */
export async function withTenantTxFor<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Resuelve el tenant a partir del phone_number_id de WhatsApp. Usa una función
 * SECURITY DEFINER acotada porque la consulta es previa a tener contexto de
 * tenant (no se puede leer tenant_config bajo RLS sin saber el tenant todavía).
 */
export async function resolveTenantByWhatsappPhone(phoneNumberId: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT resolve_tenant_by_whatsapp_phone(${phoneNumberId}) AS tenant_id`,
  )) as Array<{ tenant_id: string | null }>;
  return rows[0]?.tenant_id ?? null;
}
