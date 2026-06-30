import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantBankAccount } from "./tenant-bank-account";

// Secreto NOMBRADO de un banco/proveedor del tenant. Un proveedor como Mercado Pago necesita
// varias credenciales (public_key, access_token, webhook_secret); en vez de una columna por
// secreto en tenant_bank_account, cada secreto es una fila aquí: N por cuenta, extensible a
// proveedores nuevos sin migrar el esquema.
//
// CIFRADO EN REPOSO (requisito duro): `value_encrypted` guarda AES-256-GCM con prefijo
// versionado (`enc:v1:...`), igual que tenant_bank_account.api_key. El valor en claro JAMÁS
// se devuelve por API ni se escribe en logs; la vista expone solo la PRESENCIA del secreto.
// Aislado por tenant con RLS FORCE (política en la migración). Se borra en cascada con la cuenta.
export const bankCredential = pgTable(
  "bank_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => tenantBankAccount.id, { onDelete: "cascade" }),
    // Nombre del secreto (ej. "public_key", "access_token", "webhook_secret").
    name: text("name").notNull(),
    // Valor CIFRADO (enc:v1:...). Nunca en claro, nunca en logs ni en respuestas.
    valueEncrypted: text("value_encrypted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un secreto por (cuenta, nombre): el upsert al reconfigurar es idempotente.
    byNameIdx: uniqueIndex("bank_credential_account_name_idx").on(t.bankAccountId, t.name),
  }),
);
