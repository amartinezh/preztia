import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Rol del usuario operador (espejo del UserRole del cliente). Define qué puede
// hacer y se incluye como claim en el JWT; la autoridad real la imponen el
// backend y RLS.
export const userRole = pgEnum("user_role", ["ADMIN", "COORDINATOR", "COLLECTOR"]);

// Usuario operador de un tenant (IAM). El login deriva el tenant/rol/zonas de los
// claims del JWT firmado a partir de esta fila; nunca de input del cliente.
// password_hash es scrypt (sal+hash, sin dependencias externas). email es único
// GLOBAL para que el login (previo a tener contexto de tenant) sea inequívoco.
export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    // Subárbol(es) de zonas asignadas (paths ltree) para authZ de alcance.
    zonePaths: text("zone_paths")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // El email identifica a un único usuario en toda la plataforma.
    byEmailIdx: uniqueIndex("app_user_email_idx").on(t.email),
  }),
);
