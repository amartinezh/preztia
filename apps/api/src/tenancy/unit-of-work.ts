import { createDb } from "@preztiaos/db";
import { sql } from "drizzle-orm";
import { tenantStorage } from "./tenant-context";

const db = createDb(process.env.APP_DATABASE_URL!); // rol 'app' (sin bypass de RLS)

export async function withTenantTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error("Sin contexto de tenant");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${ctx.tenantId}, true)`);
    return fn(tx);
  });
}
