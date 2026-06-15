import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// Estado de la solicitud de cambio de cliente (maker-checker).
export const changeRequestStatus = pgEnum("change_request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// Campos del cliente que una solicitud puede proponer cambiar (subconjunto editable de borrower).
export interface BorrowerChanges {
  readonly nationalId?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly business?: string | null;
  readonly phone?: string | null;
}

// Solicitud de modificación de datos de un cliente ("Solicitud Modificar Cliente"). El cobrador
// la crea PENDING; al aprobarse, los `changes` se aplican al `borrower`. Lleva tenant_id + RLS.
export const changeRequest = pgTable(
  "change_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    borrowerId: uuid("borrower_id").notNull(),
    // Quien solicita el cambio (app_user cobrador).
    requestedBy: uuid("requested_by").notNull(),
    // Cambios propuestos (solo los campos presentes se aplican al aprobar).
    changes: jsonb("changes").$type<BorrowerChanges>().notNull(),
    status: changeRequestStatus("status").notNull().default("PENDING"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatusIdx: index("change_request_tenant_status_idx").on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
  }),
);
