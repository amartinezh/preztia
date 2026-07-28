import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Conexiones simultáneas del pool. El valor por defecto de postgres.js (10) se queda corto desde
 * que el protocolo KYC sostiene una transacción con cerrojo (`SELECT ... FOR UPDATE`) mientras
 * los adaptadores anidados (IA, antifraude) abren la SUYA: cada documento en vuelo ocupa dos
 * conexiones a la vez, y agotar el pool con la externa retenida bloquearía a la interna sin
 * salida. Configurable por entorno para ajustarlo al `max_connections` del servidor.
 */
const DEFAULT_POOL_MAX = 30;

function poolMax(): number {
  const configured = Number(process.env.PG_POOL_MAX);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_POOL_MAX;
}

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: poolMax() });
  return drizzle(client, { schema });
}
export type Db = ReturnType<typeof createDb>;
export * as schema from "./schema";
