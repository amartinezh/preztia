import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { cashBox } from "./cash-box";

// Estado del gasto (maker-checker): el cobrador solicita PENDING; el revisor aprueba/rechaza.
export const expenseStatus = pgEnum("expense_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// Gasto de cobro ("Solicitud Gastos"). Solo los APPROVED entran como `gastos` de la liquidada.
// Lleva tenant_id + RLS FORCE (política en la migración).
export const expense = pgTable(
  "expense",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Quien solicita el gasto (app_user cobrador).
    requestedBy: uuid("requested_by").notNull(),
    description: text("description").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    status: expenseStatus("status").notNull().default("PENDING"),
    // Revisor (app_user) y momento de la decisión (NULL mientras está PENDING).
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Zona del gasto = la de la caja de ruta de quien lo pidió (alcance del coordinador y zona que
    // se sella en el asiento EXPENSE). NULL = gasto del tenant (solo el ADMIN lo revisa).
    zoneId: uuid("zone_id"),
    // Motivo del rechazo (obligatorio al rechazar; queda en el historial del cobrador).
    rejectionReason: text("rejection_reason"),
    // Caja/cuenta de la que salió el dinero al aprobar (el asiento EXPENSE también lo traza).
    paidFromCashBoxId: uuid("paid_from_cash_box_id").references(() => cashBox.id),
    // Comprobante (foto o PDF) CIFRADO en MinIO (AES-256-GCM). Obligatorio en solicitudes nuevas;
    // NULL solo en gastos anteriores a la Fase 3.
    receiptStorageKey: text("receipt_storage_key"),
    receiptMimeType: text("receipt_mime_type"),
    receiptSha256: text("receipt_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatusIdx: index("expense_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    // Historial del cobrador (sus solicitudes, más recientes primero).
    byRequesterIdx: index("expense_requester_created_idx").on(t.tenantId, t.requestedBy, t.createdAt),
  }),
);
