import type { Config } from "drizzle-kit";
export default {
  schema: "./src/schema/*",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! }, // migraciones con el dueño del esquema
} satisfies Config;
