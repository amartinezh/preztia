import {
  pgTable,
  uuid,
  integer,
  jsonb,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// Veredicto del pipeline antifraude (mismos valores que FraudStatus del dominio).
export const validationStatus = pgEnum("validation_status", [
  "approved",
  "suspicious",
  "rejected",
]);

/** Alerta serializada del reporte (documento + campo + severidad + detalle). */
export interface StoredValidationAlert {
  readonly documento: string;
  readonly campo: string;
  readonly severidad: string;
  readonly detalle: string;
}

// Reporte del pipeline de validación documental antifraude de una solicitud
// (Etapas 2-4 sobre las extracciones de la Etapa 1). APPEND-ONLY: cada corrida
// inserta una fila nueva; el historial de veredictos nunca se edita ni borra
// (auditabilidad). La más reciente por solicitud es el veredicto vigente.
export const documentValidation = pgTable(
  "document_validation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    status: validationStatus("status").notNull(),
    // Riesgo agregado 0..100 (entero; mayor = más riesgo).
    score: integer("score").notNull(),
    alerts: jsonb("alerts").$type<StoredValidationAlert[]>().notNull(),
    // Fuentes externas que respondieron (trazabilidad de las Etapas 3/4).
    consultedSources: jsonb("consulted_sources").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byApplicationIdx: index("document_validation_application_idx").on(t.applicationId),
  }),
);
