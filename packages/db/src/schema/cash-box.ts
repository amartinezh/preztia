import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantBankAccount } from "./tenant-bank-account";

// Clasificación de cajas:
//  CASH    → Caja Menor (efectivo): todo movimiento exige motivo (regla en dominio).
//  BANK    → Caja bancaria: vinculada OBLIGATORIAMENTE a una tenant_bank_account.
//  TRANSIT → Fondos No Identificados / en tránsito: recibe dinero sin conciliar hasta
//            que el admin lo clasifica (lo transfiere a su caja real). Una por tenant.
export const cashBoxType = pgEnum("cash_box_type", ["CASH", "BANK", "TRANSIT"]);

// Caja del tenant. El saldo NO se almacena: se deriva de Σ cash_transaction (read-model).
// Lleva tenant_id + RLS FORCE (política en la migración).
export const cashBox = pgTable(
  "cash_box",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    type: cashBoxType("type").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    // Obligatoria si type=BANK; NULL en CASH/TRANSIT (garantizado por el CHECK).
    bankAccountId: uuid("bank_account_id").references(() => tenantBankAccount.id),
    // Cobrador (app_user) dueño de la caja de RUTA: el efectivo que lleva en la calle.
    // Solo aplica a cajas CASH (garantizado por el CHECK). NULL = caja de oficina/menor.
    // Sin FK, igual que created_by/performed_by (RLS aísla por tenant).
    assignedTo: uuid("assigned_to"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Invariante de vinculación: BANK ⇒ tiene cuenta; CASH/TRANSIT ⇒ no la tiene.
    bankLink: check(
      "cash_box_bank_link_chk",
      sql`(${t.type} = 'BANK' and ${t.bankAccountId} is not null)
       or (${t.type} <> 'BANK' and ${t.bankAccountId} is null)`,
    ),
    // Solo una caja de efectivo (de ruta) puede tener cobrador asignado.
    assigneeOnlyCash: check(
      "cash_box_assignee_only_cash_chk",
      sql`${t.assignedTo} is null or ${t.type} = 'CASH'`,
    ),
    // Una sola caja de tránsito por tenant.
    oneTransit: uniqueIndex("cash_box_one_transit_idx")
      .on(t.tenantId)
      .where(sql`type = 'TRANSIT'`),
    // Una caja bancaria por cuenta (no dos cajas apuntando a la misma cuenta real).
    oneBankBox: uniqueIndex("cash_box_bank_account_idx")
      .on(t.bankAccountId)
      .where(sql`bank_account_id is not null`),
  }),
);
