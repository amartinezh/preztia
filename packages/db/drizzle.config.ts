import type { Config } from "drizzle-kit";
import { config } from "dotenv";
import { resolve } from "node:path";

// Carga el .env de la raíz del monorepo (dos niveles arriba)
config({ path: resolve(__dirname, "../../.env") });

export default {
  schema: "./src/schema/*",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! }, // migraciones con el dueño del esquema
} satisfies Config;
