import { pgTable, uuid, text, timestamp, customType, integer, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tipo ltree (no nativo en drizzle): lo declaramos como custom type
export const ltree = customType<{ data: string }>({ dataType: () => "ltree" });

// Base sobre la que se calcula la comisión del cobrador (dominio: `cash/commission.ts`): lo cobrado
// en efectivo en ruta, lo rendido (entregado/consignado neto) o el capital recuperado.
export const commissionBase = pgEnum("commission_base", ["COLLECTED", "REMITTED", "PRINCIPAL_RECOVERED"]);

export const zone = pgTable("zone", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parentZoneId: uuid("parent_zone_id"),
  path: ltree("path").notNull(),
  name: text("name").notNull(),
  // Teléfono de atención al cliente de la zona: número humano que se comparte con el cliente
  // para soporte/informativo (NO el phone_number_id de Meta). Nullable; puede repetirse entre zonas.
  supportPhone: text("support_phone"),
  // Comisión PROPIA de la zona (base-mil + base). Ambas NULL = hereda del ancestro más cercano con
  // configuración o, si ninguno, del valor por defecto del tenant. El tope lo valida el dominio.
  commissionRatePerMille: integer("commission_rate_per_mille"),
  commissionBase: commissionBase("commission_base"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Se configuran juntas o ninguna (sin políticas a medias), y la tasa vive en [0, 100 %].
  commissionComplete: check(
    "zone_commission_complete_chk",
    sql`(commission_rate_per_mille is null) = (commission_base is null)`,
  ),
  commissionRange: check(
    "zone_commission_rate_chk",
    sql`commission_rate_per_mille is null or commission_rate_per_mille between 0 and 1000`,
  ),
}));

export const zoneCoordinator = pgTable("zone_coordinator", {
  zoneId: uuid("zone_id").notNull(),
  coordinatorId: uuid("coordinator_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
});
