import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Vínculo deudor ↔ teléfono de WhatsApp. Es tabla propia (y no columna en
// credit) porque el teléfono puede cambiar sin tocar el crédito y un deudor
// puede tener varios créditos; la búsqueda de pagos es teléfono → deudor →
// crédito ACTIVO.
export const borrowerContact = pgTable(
  "borrower_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    // Teléfono del deudor (E.164 sin '+'), igual que applicant_phone.
    phone: text("phone").notNull(),
    // phone_number_id del canal de WhatsApp por el que se contactó (opcional).
    channelId: text("channel_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un teléfono identifica a un solo deudor dentro del tenant.
    byPhoneIdx: uniqueIndex("borrower_contact_tenant_phone_idx").on(t.tenantId, t.phone),
  }),
);
