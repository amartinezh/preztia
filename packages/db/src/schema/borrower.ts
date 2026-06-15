import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  doublePrecision,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Etiqueta de color del cliente (espejo del legado: Ninguno/Amarillo/Azul/Rojo/Verde/Naranja).
export const borrowerColor = pgEnum("borrower_color", [
  "NONE",
  "YELLOW",
  "BLUE",
  "RED",
  "GREEN",
  "ORANGE",
]);

// Registro canónico del CLIENTE (deudor): la entidad "Cliente" del legado. Antes `borrower_id`
// era un uuid suelto referenciado por `credit`/`borrower_contact`/`collector_client`; esta tabla
// le da identidad con cédula, nombre, negocio, geo, color, cupo (límite) y bloqueo de créditos.
// Toda tabla de negocio lleva `tenant_id` + RLS FORCE (la política va en la migración).
export const borrower = pgTable(
  "borrower",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Cédula/identificación del cliente (texto: el legado admite formatos variados).
    nationalId: text("national_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    // Negocio/ocupación (Negocio del legado): lanchonete, Uber, salón, etc.
    business: text("business"),
    // Teléfono del cliente (E.164 sin '+' u otro formato local).
    phone: text("phone"),
    // Geolocalización para "Ver en Mapa" / "Posición de Clientes".
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    color: borrowerColor("color").notNull().default("NONE"),
    // Bloqueo de nuevos créditos (Créditos → Bloquear/Permitir).
    creditBlocked: boolean("credit_blocked").notNull().default(false),
    // Cupo aprobado (límite de crédito) en unidades menores de la moneda del tenant.
    creditLimitMinor: bigint("credit_limit_minor", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // La cédula identifica a un cliente de forma única dentro del tenant.
    byNationalIdIdx: uniqueIndex("borrower_tenant_national_id_idx").on(
      t.tenantId,
      t.nationalId,
    ),
  }),
);
