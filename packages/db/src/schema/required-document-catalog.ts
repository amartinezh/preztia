import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { requiredDocument } from "./credit-application";

// Catálogo configurable POR TENANT de los documentos que exige el proceso KYC.
// Es la fuente de verdad de qué documentos se piden, en qué orden, con qué título
// (lo que ve el usuario en el chat) y con qué descripción (pista para que la IA
// identifique el documento recibido). Lleva tenant_id + RLS como toda tabla de negocio.
export const creditDocumentRequirement = pgTable(
  "credit_document_requirement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // Llave estable del documento (coincide con RequiredDocumentType del dominio y
    // con document_type de credit_application_document).
    documentKey: requiredDocument("document_key").notNull(),
    // Título mostrado en el chat para pedir el documento al usuario.
    title: text("title").notNull(),
    // Descripción suficiente para que la IA identifique el documento (caso Brasil).
    description: text("description").notNull(),
    // Orden de solicitud dentro del protocolo (menor se pide primero).
    sortOrder: integer("sort_order").notNull(),
    // Permite desactivar un documento sin borrar su historial/configuración.
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Un documento por llave dentro del tenant.
    byTenantKeyIdx: uniqueIndex("credit_document_requirement_tenant_key_idx").on(
      t.tenantId,
      t.documentKey,
    ),
  }),
);
